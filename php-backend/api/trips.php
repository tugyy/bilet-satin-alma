<?php
require_once '../config.php';
require_once '../auth.php';

/**
 * @OA
tags={"trips"}
 *
 * @OA\Get(
 *     path="/api/trips.php",
 *     summary="Seferleri listele / ara (ziyaretçi ve kullanıcılar için)",
 *     @OA\Parameter(name="departure_city", in="query", @OA\Schema(type="string")),
 *     @OA\Parameter(name="destination_city", in="query", @OA\Schema(type="string")),
 *     @OA\Parameter(name="date", in="query", @OA\Schema(type="string", format="date")),
 *     @OA\Parameter(name="company_id", in="query", @OA\Schema(type="string")),
 *     @OA\Parameter(name="min_price", in="query", @OA\Schema(type="integer")),
 *     @OA\Parameter(name="max_price", in="query", @OA\Schema(type="integer")),
 *     @OA\Parameter(name="limit", in="query", @OA\Schema(type="integer")),
 *     @OA\Parameter(name="offset", in="query", @OA\Schema(type="integer")),
 *     @OA\Parameter(name="sort_by", in="query", @OA\Schema(type="string", enum={"price","departure_time"})),
 *     @OA\Parameter(name="sort_dir", in="query", @OA\Schema(type="string", enum={"asc","desc"})),
 *     @OA\Response(response="200", description="Başarılı")
 * )
 *
 * @OA\Get(
 *     path="/api/trips.php/{id}",
 *     summary="Sefer detayını getir",
 *     @OA\Parameter(name="id", in="path", required=true, @OA\Schema(type="string")),
 *     @OA\Response(response="200", description="Başarılı")
 * )
 */

$method = $_SERVER['REQUEST_METHOD'];
$db = getDB();

try {
    if ($method === 'GET') {
        // Extract ID from URL path if present (/api/trips.php/{id})
        $tripId = null;
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $pathParts = explode('/', trim($path, '/'));
        $lastPart = end($pathParts);
        // Avoid treating action segments like 'tickets' as the trip id
        if ($lastPart !== 'trips.php' && $lastPart !== 'tickets' && !empty($lastPart) && strlen($lastPart) > 4) {
            $tripId = $lastPart;
        }

        // Determine authenticated user payload (if any) early so it can be used for trip detail
        $userPayload = null;
        if (isset($_SERVER['HTTP_AUTHORIZATION']) || isset($_SERVER['Authorization']) || isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $token = getBearerToken();
            if ($token) {
                $userPayload = verifyJWT($token);
            }
        }

        if ($tripId) {
            // Get single trip details
            $stmt = $db->prepare("SELECT t.id, t.company_id, bc.name AS company_name, bc.logo_path AS company_logo, t.destination_city, t.arrival_time, t.departure_time, t.departure_city, t.price, t.capacity, (
                SELECT COUNT(*) FROM Booked_Seats bs
                JOIN Tickets tk ON tk.id = bs.ticket_id
                WHERE tk.trip_id = t.id AND tk.status = 'active'
            ) AS booked_seats
            FROM Trips t
            LEFT JOIN Bus_Company bc ON bc.id = t.company_id
            WHERE t.id = ?");
            $stmt->execute([$tripId]);
            $trip = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$trip) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Sefer bulunamadi']);
                exit;
            }

            $trip['available_seats'] = max(0, $trip['capacity'] - (int)$trip['booked_seats']);

            // If user is authenticated, indicate whether they have a ticket for this trip
            if ($userPayload) {
                $userTicketStmt = $db->prepare("SELECT COUNT(*) as cnt FROM Tickets WHERE trip_id = ? AND user_id = ? AND status = 'active'");
                $userTicketStmt->execute([$tripId, $userPayload['user_id']]);
                $cnt = $userTicketStmt->fetch(PDO::FETCH_ASSOC);
                $trip['user_has_ticket'] = ($cnt && $cnt['cnt'] > 0) ? true : false;
            }

            // Build seat-level availability: for seats 1..capacity mark booked/available
            $bookedSeatsStmt = $db->prepare("SELECT bs.seat_number, tk.id AS ticket_id, tk.user_id FROM Booked_Seats bs JOIN Tickets tk ON tk.id = bs.ticket_id WHERE tk.trip_id = ? AND tk.status = 'active'");
            $bookedSeatsStmt->execute([$tripId]);
            $booked = [];
            while ($row = $bookedSeatsStmt->fetch(PDO::FETCH_ASSOC)) {
                $booked[(int)$row['seat_number']] = ['ticket_id' => $row['ticket_id'], 'user_id' => $row['user_id']];
            }

            $seats = [];
            $capacity = (int)$trip['capacity'];
            for ($i = 1; $i <= $capacity; $i++) {
                if (isset($booked[$i])) {
                    $seats[] = [
                        'seat_number' => $i,
                        'status' => 'booked',
                        // frontend convenience: indicate UI should disable booked seats
                        'disabled' => true,
                        'ticket_id' => $booked[$i]['ticket_id'],
                        'user_id' => $booked[$i]['user_id']
                    ];
                } else {
                    $seats[] = [
                        'seat_number' => $i,
                        'status' => 'available'
                        , 'disabled' => false
                    ];
                }
            }

            $trip['seats'] = $seats;

            http_response_code(200);
            echo json_encode(['success' => true, 'data' => $trip]);
            exit;
        }

        // If path was /api/trips.php/{id}/tickets (tickets action), handle in caller above; but parse here for backward compatibility
        // Note: some servers may expose action as additional path segment; re-check REQUEST_URI
        $uriAfter = '';
        $uriFull = $_SERVER['REQUEST_URI'];
        $pos = strpos($uriFull, 'trips.php');
        if ($pos !== false) {
            $uriAfter = substr($uriFull, $pos + strlen('trips.php'));
            $uriAfter = trim($uriAfter, '/');
        }
        if ($uriAfter !== '' && strpos($uriAfter, '/') !== false) {
            $afterParts = explode('/', $uriAfter);
            // patterns: {id}/tickets or {id}/something
            if (count($afterParts) >= 2 && $afterParts[1] === 'tickets') {
                // determine trip id from URI (first segment after trips.php)
                $tripId = $afterParts[0] ?? null;
                // ensure user is authenticated and is company manager for this trip
                $res = ensureUserIsCompanyManagerForTrip($tripId);
                // Gather tickets for trip
                // Include coupon_id and coupon code (if ticket used a coupon)
                $ticketStmt = $db->prepare("SELECT tk.id as ticket_id, tk.user_id, tk.total_price, tk.status, tk.created_at, tk.coupon_id, c.code AS coupon_code, u.full_name, u.email FROM Tickets tk LEFT JOIN User u ON u.id = tk.user_id LEFT JOIN Coupons c ON c.id = tk.coupon_id WHERE tk.trip_id = ?");
                $ticketStmt->execute([$tripId]);
                $tickets = $ticketStmt->fetchAll(PDO::FETCH_ASSOC);

                // For each ticket fetch booked seats (return seat id and seat_number)
                $seatStmt = $db->prepare("SELECT id, seat_number FROM Booked_Seats WHERE ticket_id = ? ORDER BY seat_number ASC");
                foreach ($tickets as &$tkt) {
                    $seatStmt->execute([$tkt['ticket_id']]);
                    $seats = $seatStmt->fetchAll(PDO::FETCH_ASSOC);
                    // normalize seat_number to integer
                    foreach ($seats as &$s) {
                        $s['seat_number'] = isset($s['seat_number']) ? (int)$s['seat_number'] : $s['seat_number'];
                    }
                    $tkt['seats'] = $seats;
                    // Expose coupon_code to frontend if present
                    if (isset($tkt['coupon_code'])) {
                        $tkt['coupon_code'] = $tkt['coupon_code'];
                    } else {
                        $tkt['coupon_code'] = null;
                    }
                }

                http_response_code(200);
                echo json_encode(['success' => true, 'data' => $tickets]);
                exit;
            }
        }

        // Otherwise list/search trips
        $params = [];
        $wheres = [];

        // If authenticated and requesting own company trips, allow company managers to filter by their company
        $userPayload = null;
        if (isset($_SERVER['HTTP_AUTHORIZATION']) || isset($_SERVER['Authorization']) || isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $token = getBearerToken();
            if ($token) {
                $userPayload = verifyJWT($token);
            }
        }

        // Filters from query
        if (isset($_GET['departure_city']) && $_GET['departure_city'] !== '') {
            $wheres[] = 'LOWER(departure_city) LIKE LOWER(?)';
            $params[] = '%' . $_GET['departure_city'] . '%';
        }
        if (isset($_GET['destination_city']) && $_GET['destination_city'] !== '') {
            $wheres[] = 'LOWER(destination_city) LIKE LOWER(?)';
            $params[] = '%' . $_GET['destination_city'] . '%';
        }
        if (isset($_GET['company_id']) && $_GET['company_id'] !== '') {
            $wheres[] = 'company_id = ?';
            $params[] = $_GET['company_id'];
        }

        // If client requested only their company's trips via mine=true and user is company manager, apply company filter
        if (isset($_GET['mine']) && ($_GET['mine'] === '1' || strtolower($_GET['mine']) === 'true') && $userPayload) {
            // ensure user is company role and has company_id
            if (isset($userPayload['role']) && $userPayload['role'] === 'company') {
                // fetch user's company_id from DB (safer than trusting token)
                $ustmt = $db->prepare("SELECT company_id FROM User WHERE id = ?");
                $ustmt->execute([$userPayload['user_id']]);
                $u = $ustmt->fetch(PDO::FETCH_ASSOC);
                if ($u && $u['company_id']) {
                    $wheres[] = 'company_id = ?';
                    $params[] = $u['company_id'];
                }
            }
        }
        if (isset($_GET['date']) && $_GET['date'] !== '') {
            // match date component of departure_time
            $wheres[] = "date(departure_time) = date(?)";
            $params[] = $_GET['date'];
        }
        if (isset($_GET['min_price']) && is_numeric($_GET['min_price'])) {
            $wheres[] = 'price >= ?';
            $params[] = (int)$_GET['min_price'];
        }
        if (isset($_GET['max_price']) && is_numeric($_GET['max_price'])) {
            $wheres[] = 'price <= ?';
            $params[] = (int)$_GET['max_price'];
        }

        // By default, exclude trips whose departure_time is in the past (do not show expired trips on public listing)
        // Allow clients with proper privileges to opt-in by passing include_past=true (admins/companies can use this).
        $includePast = false;
        if (isset($_GET['include_past']) && (($_GET['include_past'] === '1') || strtolower($_GET['include_past']) === 'true')) {
            $includePast = true;
        }
        // If not explicitly allowed, add filter to only show future trips
        if (!$includePast) {
            // SQLite: use datetime('now') to compare
            $wheres[] = "departure_time > datetime('now')";
        }

        $whereSql = '';
        if (!empty($wheres)) {
            $whereSql = 'WHERE ' . implode(' AND ', $wheres);
        }

        // Sorting
        $allowedSort = ['price' => 'price', 'departure_time' => 'departure_time'];
        $sortBy = 'departure_time';
        if (isset($_GET['sort_by']) && array_key_exists($_GET['sort_by'], $allowedSort)) {
            $sortBy = $allowedSort[$_GET['sort_by']];
        }
        $sortDir = 'ASC';
        if (isset($_GET['sort_dir']) && strtolower($_GET['sort_dir']) === 'desc') {
            $sortDir = 'DESC';
        }

        // Pagination
        $limit = 50;
        if (isset($_GET['limit']) && is_numeric($_GET['limit'])) {
            $limit = max(1, min(200, (int)$_GET['limit']));
        }
        $offset = 0;
        if (isset($_GET['offset']) && is_numeric($_GET['offset'])) {
            $offset = max(0, (int)$_GET['offset']);
        }

        // Build main query: include booked_seats subquery and available_seats calculation
    $sql = "SELECT t.id, t.company_id, bc.name AS company_name, bc.logo_path AS company_logo, t.destination_city, t.arrival_time, t.departure_time, t.departure_city, t.price, t.capacity, (
                SELECT COUNT(*) FROM Booked_Seats bs
                JOIN Tickets tk ON tk.id = bs.ticket_id
                WHERE tk.trip_id = t.id AND tk.status = 'active'
            ) AS booked_seats
            FROM Trips t
            LEFT JOIN Bus_Company bc ON bc.id = t.company_id
            $whereSql
            ORDER BY $sortBy $sortDir
            LIMIT ? OFFSET ?";

        // Add limit and offset to params
        $execParams = $params;
        $execParams[] = $limit;
        $execParams[] = $offset;

        $stmt = $db->prepare($sql);
        $stmt->execute($execParams);
        $trips = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Compute available seats for each trip
        foreach ($trips as &$t) {
            $t['available_seats'] = max(0, $t['capacity'] - (int)$t['booked_seats']);
        }

        // Also provide total count matching filters
        $countSql = "SELECT COUNT(*) as cnt FROM Trips t $whereSql";
        $countStmt = $db->prepare($countSql);
        $countStmt->execute($params);
        $total = (int)$countStmt->fetch(PDO::FETCH_ASSOC)['cnt'];

        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $trips,
            'count' => count($trips),
            'total' => $total,
            'limit' => $limit,
            'offset' => $offset
        ]);
        exit;
    }

    // Create a new trip - only company managers can create trips for their company
    if ($method === 'POST') {
        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
            exit;
        }

        // Required fields: destination_city, arrival_time, departure_time, departure_city, price, capacity
        $required = ['destination_city', 'arrival_time', 'departure_time', 'departure_city', 'price', 'capacity'];
        foreach ($required as $r) {
            if (!isset($data[$r]) || $data[$r] === '') {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => "$r gerekli"]);
                exit;
            }
        }

        // Authenticate user and use their company_id server-side instead of trusting client-provided company_id
        $payload = authenticateUser();
        if (!isset($payload['role']) || $payload['role'] !== 'company') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Bu işlem için firma yöneticisi olmalısınız']);
            exit;
        }

        // Get user's company_id from DB
        $ustmt = $db->prepare("SELECT company_id FROM User WHERE id = ?");
        $ustmt->execute([$payload['user_id']]);
        $u = $ustmt->fetch(PDO::FETCH_ASSOC);
        if (!$u || empty($u['company_id'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Kullanıcının bir firmaya bağlılığı yok veya yetki yetersiz']);
            exit;
        }
        $companyId = $u['company_id'];

        // Validate numeric fields and business rules
        if (!is_numeric($data['price']) || !is_numeric($data['capacity'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'price ve capacity sayisal olmalidir']);
            exit;
        }
        if ((int)$data['price'] <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'price sifirdan buyuk olmalidir']);
            exit;
        }
        if ((int)$data['capacity'] < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'capacity en az 1 olmalidir']);
            exit;
        }

        // Generate UUID for trip
        $uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );

        $ins = $db->prepare("INSERT INTO Trips (id, company_id, destination_city, arrival_time, departure_time, departure_city, price, capacity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $ins->execute([$uuid, $companyId, $data['destination_city'], $data['arrival_time'], $data['departure_time'], $data['departure_city'], (int)$data['price'], (int)$data['capacity']]);

        http_response_code(201);
        echo json_encode(['success' => true, 'message' => 'Sefer olusturuldu', 'id' => $uuid]);
        exit;
    }

    // Update trip - only company manager owning the trip
    if ($method === 'PATCH') {
        // Extract id from URL path if present (/api/trips.php/{id})
        $tripId = null;
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $pathParts = explode('/', trim($path, '/'));
        $lastPart = end($pathParts);
        if ($lastPart !== 'trips.php' && !empty($lastPart) && strlen($lastPart) > 4) {
            $tripId = $lastPart;
        }

        if (!$tripId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Sefer id gerekli']);
            exit;
        }

        // Ensure user is company manager for this trip
        $res = ensureUserIsCompanyManagerForTrip($tripId);
        $payload = $res['payload'];
        $trip = $res['trip'];

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data) || empty($data)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Guncellenecek alanlar gerekli']);
            exit;
        }

        $allowed = ['destination_city', 'arrival_time', 'departure_time', 'departure_city', 'price', 'capacity'];
        $fields = [];
        $values = [];
        foreach ($allowed as $a) {
            if (array_key_exists($a, $data)) {
                if (($a === 'price' || $a === 'capacity') && !is_numeric($data[$a])) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'error' => "$a sayisal olmalidir"]);
                    exit;
                }
                // business rule: price must be > 0
                if ($a === 'price' && (int)$data['price'] <= 0) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'error' => 'price sifirdan buyuk olmalidir']);
                    exit;
                }
                // business rule: do not allow reducing capacity value (any decrease)
                if ($a === 'capacity') {
                    $newCap = (int)$data['capacity'];
                    $currentCap = isset($trip['capacity']) ? (int)$trip['capacity'] : null;
                    if ($currentCap !== null && $newCap < $currentCap) {
                        http_response_code(409);
                        echo json_encode(['success' => false, 'error' => 'Kapasite azaltılamaz']);
                        exit;
                    }
                }

                $fields[] = "$a = ?";
                $values[] = $data[$a];
            }
        }

        if (empty($fields)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Guncellenecek alan yok']);
            exit;
        }

        // If capacity is being reduced, ensure it is not less than already booked seats
        if (array_key_exists('capacity', $data)) {
            $bookedStmt = $db->prepare("SELECT COUNT(*) as cnt FROM Booked_Seats bs JOIN Tickets tk ON tk.id = bs.ticket_id WHERE tk.trip_id = ? AND tk.status = 'active'");
            $bookedStmt->execute([$tripId]);
            $bookedCountRow = $bookedStmt->fetch(PDO::FETCH_ASSOC);
            $bookedCount = $bookedCountRow ? (int)$bookedCountRow['cnt'] : 0;
            if ((int)$data['capacity'] < $bookedCount) {
                http_response_code(409);
                echo json_encode(['success' => false, 'error' => 'Yeni kapasite, mevcut rezerve edilmiş koltuk sayısından az olamaz']);
                exit;
            }
        }

        $values[] = $tripId;
        $sql = "UPDATE Trips SET " . implode(', ', $fields) . " WHERE id = ?";
        $stmt = $db->prepare($sql);
        $stmt->execute($values);

        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Sefer guncellendi']);
        exit;
    }

    // Delete trip - only company manager owning the trip. Refund active tickets and remove booked seats similar to company deletion behavior
    if ($method === 'DELETE') {
        // Extract id from URL path if present (/api/trips.php/{id})
        $tripId = null;
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $pathParts = explode('/', trim($path, '/'));
        $lastPart = end($pathParts);
        if ($lastPart !== 'trips.php' && !empty($lastPart) && strlen($lastPart) > 4) {
            $tripId = $lastPart;
        }

        if (!$tripId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Sefer id gerekli']);
            exit;
        }

        // Ensure user is company manager for this trip
        $res = ensureUserIsCompanyManagerForTrip($tripId);

        try {
            $db->beginTransaction();

            // Refund active tickets
            $ticketStmt = $db->prepare("SELECT id, user_id, total_price FROM Tickets WHERE trip_id = ? AND status = 'active'");
            $ticketStmt->execute([$tripId]);
            $tickets = $ticketStmt->fetchAll(PDO::FETCH_ASSOC);

            $updateBalance = $db->prepare("UPDATE User SET balance = COALESCE(balance, 0) + ? WHERE id = ?");
            $deleteBookedSeats = $db->prepare("DELETE FROM Booked_Seats WHERE ticket_id = ?");
            $cancelTicket = $db->prepare("UPDATE Tickets SET status = 'canceled' WHERE id = ?");
            $deleteTicket = $db->prepare("DELETE FROM Tickets WHERE id = ?");

            foreach ($tickets as $tk) {
                $price = (int)$tk['total_price'];
                $userId = $tk['user_id'];
                if ($price > 0) {
                    $updateBalance->execute([$price, $userId]);
                }
                $deleteBookedSeats->execute([$tk['id']]);
                $cancelTicket->execute([$tk['id']]);
                $deleteTicket->execute([$tk['id']]);
            }

            // Delete trip
            $del = $db->prepare("DELETE FROM Trips WHERE id = ?");
            $del->execute([$tripId]);

            $db->commit();
            http_response_code(200);
            echo json_encode(['success' => true, 'message' => 'Sefer silindi ve bilet sahiplerine ücretleri iade edildi']);
            exit;
        } catch (Exception $e) {
            if ($db->inTransaction()) $db->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Silme islemi sirasinda hata: ' . $e->getMessage()]);
            exit;
        }
    }

    // Method not allowed
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Desteklenen metodlar: GET, POST, PATCH, DELETE']);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Veritabani hatasi: ' . $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
}

?>