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
	$data = json_decode(file_get_contents('php://input'), true);
	if (!is_array($data) || empty($data['code'])) {
		http_response_code(400);
		echo json_encode(['success' => false, 'error' => 'Kupon kodu (code) gerekli']);
		exit;
	}

	$code = trim($data['code']);
	$tripId = isset($data['trip_id']) ? $data['trip_id'] : null;

	$db = getDB();

	// Try to get coupon
	$stmt = $db->prepare("SELECT * FROM Coupons WHERE code = ? LIMIT 1");
	$stmt->execute([$code]);
	$coupon = $stmt->fetch(PDO::FETCH_ASSOC);

	if (!$coupon) {
		http_response_code(404);
		echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi']);
		exit;
	}

	// Check expiry
	$now = new DateTime('now');
	$expire = new DateTime($coupon['expire_date']);
	if ($expire < $now) {
		http_response_code(410);
		echo json_encode(['success' => false, 'error' => 'Kuponun süresi dolmus']);
		exit;
	}

	// Check usage limit
	if ((int)$coupon['usage_limit'] <= 0) {
		http_response_code(410);
		echo json_encode(['success' => false, 'error' => 'Kupon kullanima kapali']);
		exit;
	}

	// If trip_id provided and coupon is company-scoped, ensure matching company
	if ($tripId && !empty($coupon['company_id'])) {
		$tstmt = $db->prepare("SELECT company_id FROM Trips WHERE id = ?");
		$tstmt->execute([$tripId]);
		$trip = $tstmt->fetch(PDO::FETCH_ASSOC);
		if (!$trip) {
			http_response_code(404);
			echo json_encode(['success' => false, 'error' => 'Sefer bulunamadi']);
			exit;
		}
		if ($trip['company_id'] !== $coupon['company_id']) {
			http_response_code(400);
			echo json_encode(['success' => false, 'error' => 'Kupon bu sefer icin gecersiz']);
			exit;
		}
	}

	// Require authenticated user with role 'user' to check coupons
	$payload = authenticateUser(); // sends 401 and exits if missing/invalid
	if (!isset($payload['role']) || $payload['role'] !== 'user') {
		http_response_code(403);
		echo json_encode(['success' => false, 'error' => 'Bu islemi yapabilmek icin user rolunde olmalisiniz']);
		exit;
	}

	// Check whether this authenticated user already used this coupon
	$uStmt = $db->prepare("SELECT COUNT(*) as cnt FROM User_Coupons WHERE coupon_id = ? AND user_id = ?");
	$uStmt->execute([$coupon['id'], $payload['user_id']]);
	$row = $uStmt->fetch(PDO::FETCH_ASSOC);
	if ($row && intval($row['cnt']) > 0) {
		http_response_code(409);
		echo json_encode(['success' => false, 'error' => 'Kupon zaten kullanilmis']);
		exit;
	}

	// Respond with coupon info (discount as stored)
	http_response_code(200);
	echo json_encode([
		'success' => true,
		'coupon' => [
			'id' => $coupon['id'],
			'code' => $coupon['code'],
			'discount' => (float)$coupon['discount'],
			'company_id' => $coupon['company_id'],
			'usage_limit' => (int)$coupon['usage_limit'],
			'expire_date' => $coupon['expire_date']
		]
	]);
	exit;

} catch (PDOException $e) {
	http_response_code(500);
	echo json_encode(['success' => false, 'error' => 'Veritabani hatasi: ' . $e->getMessage()]);
	exit;
} catch (Exception $e) {
	http_response_code(500);
	echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
	exit;
}

?>
