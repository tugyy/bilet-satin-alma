<?php
require_once '../config.php';
require_once '../auth.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
	http_response_code(405);
	echo json_encode(['success' => false, 'error' => 'Sadece POST metodu desteklenir']);
	exit;
}

try {
	// Authenticate user (any role), but later ensure role === 'user'
	$payload = authenticateUser();
	if (!isset($payload['role']) || $payload['role'] !== 'user') {
		http_response_code(403);
		echo json_encode(['success' => false, 'error' => 'Sadece normal kullanicilar bilet satin alabilir']);
		exit;
	}

	$data = json_decode(file_get_contents('php://input'), true);
	if (!is_array($data)) {
		http_response_code(400);
		echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
		exit;
	}

	// Expected fields: trip_id, seats (array of seat numbers), optional coupon_code
	if (empty($data['trip_id']) || empty($data['seats']) || !is_array($data['seats'])) {
		http_response_code(400);
		echo json_encode(['success' => false, 'error' => 'trip_id ve seats (array) gerekli']);
		exit;
	}

	$tripId = $data['trip_id'];
	$seatsRequested = array_unique(array_map('intval', $data['seats']));
	if (count($seatsRequested) === 0) {
		http_response_code(400);
		echo json_encode(['success' => false, 'error' => 'En az bir koltuk secilmeli']);
		exit;
	}

	$couponCode = isset($data['coupon_code']) ? trim($data['coupon_code']) : null;

	$db = getDB();

	// Load trip
	$tstmt = $db->prepare("SELECT * FROM Trips WHERE id = ?");
	$tstmt->execute([$tripId]);
	$trip = $tstmt->fetch(PDO::FETCH_ASSOC);
	if (!$trip) {
		http_response_code(404);
		echo json_encode(['success' => false, 'error' => 'Sefer bulunamadi']);
		exit;
	}

	// Do not allow purchasing for trips whose departure time has already passed
	$now = new DateTime('now');
	$departure = new DateTime($trip['departure_time']);
	if ($departure->getTimestamp() <= $now->getTimestamp()) {
		http_response_code(410);
		echo json_encode(['success' => false, 'error' => 'Seferin kalkis zamani gecti; bilet satin alinamaz']);
		exit;
	}

	$capacity = (int)$trip['capacity'];
	foreach ($seatsRequested as $s) {
		if ($s < 1 || $s > $capacity) {
			http_response_code(400);
			echo json_encode(['success' => false, 'error' => "Gecersiz koltuk numarasi: $s"]);
			exit;
		}
	}

	// Begin transaction to ensure atomicity
	$db->beginTransaction();

	// Re-check availability for requested seats (lock using SELECT .. FOR UPDATE not available in sqlite)
	// We'll check whether any of the seats are already booked in active tickets
	$inPlaceholders = implode(',', array_fill(0, count($seatsRequested), '?'));
	$params = $seatsRequested;
	// Prepare query to find any booked seats among requested
	$q = "SELECT bs.seat_number FROM Booked_Seats bs JOIN Tickets tk ON tk.id = bs.ticket_id WHERE tk.trip_id = ? AND tk.status = 'active' AND bs.seat_number IN ($inPlaceholders)";
	$checkParams = array_merge([$tripId], $params);
	$chkStmt = $db->prepare($q);
	$chkStmt->execute($checkParams);
	$already = $chkStmt->fetchAll(PDO::FETCH_COLUMN, 0);
	if (!empty($already)) {
		$db->rollBack();
		http_response_code(409);
		echo json_encode(['success' => false, 'error' => 'Secilen koltuk(lar) zaten rezerve edilmistir', 'seats' => array_values($already)]);
		exit;
	}

	// Calculate price
	$pricePerSeat = (int)$trip['price'];
	$totalPrice = $pricePerSeat * count($seatsRequested);

	$appliedCouponId = null;
	$discountAmount = 0;

	// If coupon provided, validate and apply
	if ($couponCode) {
		// Fetch coupon row and validate similar to check_coupon
		$cstmt = $db->prepare("SELECT * FROM Coupons WHERE code = ? LIMIT 1");
		$cstmt->execute([$couponCode]);
		$coupon = $cstmt->fetch(PDO::FETCH_ASSOC);
		if (!$coupon) {
			$db->rollBack();
			http_response_code(404);
			echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi']);
			exit;
		}

		$now = new DateTime('now');
		$expire = new DateTime($coupon['expire_date']);
		if ($expire < $now) {
			$db->rollBack();
			http_response_code(410);
			echo json_encode(['success' => false, 'error' => 'Kuponun süresi dolmus']);
			exit;
		}
		if ((int)$coupon['usage_limit'] <= 0) {
			$db->rollBack();
			http_response_code(410);
			echo json_encode(['success' => false, 'error' => 'Kupon kullanima kapali']);
			exit;
		}
		if (!empty($coupon['company_id']) && $coupon['company_id'] !== $trip['company_id']) {
			$db->rollBack();
			http_response_code(400);
			echo json_encode(['success' => false, 'error' => 'Kupon bu sefer icin gecersiz']);
			exit;
		}

		// Ensure user hasn't already used this coupon
		$uStmt = $db->prepare("SELECT COUNT(*) as cnt FROM User_Coupons WHERE coupon_id = ? AND user_id = ?");
		$uStmt->execute([$coupon['id'], $payload['user_id']]);
		$row = $uStmt->fetch(PDO::FETCH_ASSOC);
		if ($row && $row['cnt'] > 0) {
			$db->rollBack();
			http_response_code(409);
			echo json_encode(['success' => false, 'error' => 'Kupon zaten kullanilmis']);
			exit;
		}

		// discount stored as percentage (e.g. 10 = 10%). Business rule: maximum allowed discount is 50%.
		$raw = (float)$coupon['discount'];
		if ($raw <= 0) {
			$db->rollBack();
			http_response_code(400);
			echo json_encode(['success' => false, 'error' => 'Kupon gecersiz indirim degeri']);
			exit;
		}
		// Cap discount at 50% to enforce business rule
		$percent = min(50.0, $raw);
		$discountAmount = (int)round($totalPrice * ($percent / 100.0));
		$appliedCouponId = $coupon['id'];
	}

	$finalPrice = max(0, $totalPrice - $discountAmount);

	// Check user's balance (balance may be NULL for admin but users have default 800)
	$balStmt = $db->prepare("SELECT COALESCE(balance,0) as balance FROM User WHERE id = ?");
	$balStmt->execute([$payload['user_id']]);
	$bRow = $balStmt->fetch(PDO::FETCH_ASSOC);
	$balance = $bRow ? (int)$bRow['balance'] : 0;
	if ($balance < $finalPrice) {
		$db->rollBack();
		http_response_code(402);
		echo json_encode(['success' => false, 'error' => 'Yetersiz bakiye']);
		exit;
	}

	// Create ticket
	$ticketId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
		mt_rand(0, 0xffff), mt_rand(0, 0xffff),
		mt_rand(0, 0xffff),
		mt_rand(0, 0x0fff) | 0x4000,
		mt_rand(0, 0x3fff) | 0x8000,
		mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
	);

	// Include coupon_id if a coupon was applied (nullable)
	$insTicket = $db->prepare("INSERT INTO Tickets (id, trip_id, user_id, status, total_price, coupon_id) VALUES (?, ?, ?, 'active', ?, ?)");
	$insTicket->execute([$ticketId, $tripId, $payload['user_id'], $finalPrice, $appliedCouponId]);

	// Insert booked seats
	$insSeat = $db->prepare("INSERT INTO Booked_Seats (id, ticket_id, seat_number) VALUES (?, ?, ?)");
	foreach ($seatsRequested as $s) {
		$seatUuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
			mt_rand(0, 0xffff), mt_rand(0, 0xffff),
			mt_rand(0, 0xffff),
			mt_rand(0, 0x0fff) | 0x4000,
			mt_rand(0, 0x3fff) | 0x8000,
			mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
		);
		$insSeat->execute([$seatUuid, $ticketId, $s]);
	}

	// Deduct balance from user
	$updateBal = $db->prepare("UPDATE User SET balance = COALESCE(balance,0) - ? WHERE id = ?");
	$updateBal->execute([$finalPrice, $payload['user_id']]);

	// Decrease coupon usage and record user_coupon if applied
	if ($appliedCouponId) {
		$dec = $db->prepare("UPDATE Coupons SET usage_limit = usage_limit - 1 WHERE id = ?");
		$dec->execute([$appliedCouponId]);
		$ucIns = $db->prepare("INSERT INTO User_Coupons (id, coupon_id, user_id) VALUES (?, ?, ?)");
		$ucId = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0,0xffff),mt_rand(0,0xffff),mt_rand(0,0xffff), mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000, mt_rand(0,0xffff),mt_rand(0,0xffff),mt_rand(0,0xffff));
		$ucIns->execute([$ucId, $appliedCouponId, $payload['user_id']]);
	}

	$db->commit();

	// Return created ticket info
	$seatList = [];
	foreach ($seatsRequested as $s) {
		$seatList[] = ['seat_number' => $s];
	}

	http_response_code(201);
	echo json_encode([
		'success' => true,
		'message' => 'Bilet satin alindi',
		'ticket' => [
			'ticket_id' => $ticketId,
			'user_id' => $payload['user_id'],
			'total_price' => $finalPrice,
			'seats' => $seatList,
			'status' => 'active'
		]
	]);
	exit;

} catch (PDOException $e) {
	if ($db && $db->inTransaction()) $db->rollBack();
	http_response_code(500);
	echo json_encode(['success' => false, 'error' => 'Veritabani hatasi: ' . $e->getMessage()]);
	exit;
} catch (Exception $e) {
	if ($db && $db->inTransaction()) $db->rollBack();
	http_response_code(500);
	echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
	exit;
}

?>
