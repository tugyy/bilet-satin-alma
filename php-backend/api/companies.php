<?php
require_once '../config.php';
require_once '../auth.php';

/**
 * Admin-only Companies endpoint
 *
 * Supported operations:
 *  - GET /api/companies.php               -> list all companies
 *  - GET /api/companies.php/{id}          -> get company details
 *  - POST /api/companies.php              -> create company { name, logo_path? }
 *  - PATCH /api/companies.php/{id}        -> update company { name?, logo_path? }
 *  - DELETE /api/companies.php/{id}       -> delete company
 *  - POST /api/companies.php/{id}/assign_manager   -> { user_id }
 *  - POST /api/companies.php/{id}/remove_manager   -> { user_id }
 *
 * All routes require admin authentication via authenticateAdmin().
 */

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// All operations require admin
authenticateAdmin();

try {
    // Extract path parts to support /api/companies.php/{id} and action endpoints
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $pathParts = explode('/', trim($path, '/'));
    $last = end($pathParts);

    // Detect id and optional action
    $companyId = null;
    $action = null;
    if ($last !== 'companies.php' && !empty($last) && strlen($last) > 3) {
        // If last looks like an id or action, examine previous segment
        $companyId = $last;
        // Check if URL contains an action after id (e.g. companies.php/{id}/assign_manager)
        if (count($pathParts) >= 3) {
            $maybeAction = $pathParts[count($pathParts)-1];
            // If the script name is companies.php, previous part is id
            if ($maybeAction === $companyId && count($pathParts) >= 4) {
                $action = $pathParts[count($pathParts)-0];
            }
        }
    }

    // A simpler approach: parse REQUEST_URI and split after companies.php
    $uri = $_SERVER['REQUEST_URI'];
    $after = '';
    $pos = strpos($uri, 'companies.php');
    if ($pos !== false) {
        $after = substr($uri, $pos + strlen('companies.php'));
    }
    $after = trim($after, '/');
    $afterParts = $after === '' ? [] : explode('/', $after);
    if (count($afterParts) >= 1 && $afterParts[0] !== '') {
        $companyId = $afterParts[0];
    }
    if (count($afterParts) >= 2) {
        $action = $afterParts[1];
    }

    if ($method === 'GET') {
        if ($companyId) {
            // Get single company
            $stmt = $db->prepare("SELECT id, name, logo_path, created_at FROM Bus_Company WHERE id = ?");
            $stmt->execute([$companyId]);
            $company = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$company) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Firma bulunamadi']);
                exit;
            }

            // Also fetch managers (users with company_id = this id)
            $managersStmt = $db->prepare("SELECT id, full_name, email, role FROM User WHERE company_id = ?");
            $managersStmt->execute([$companyId]);
            $managers = $managersStmt->fetchAll(PDO::FETCH_ASSOC);
            $company['managers'] = $managers;

            http_response_code(200);
            echo json_encode(['success' => true, 'data' => $company]);
            exit;
        }

        // List all companies
        $stmt = $db->query("SELECT id, name, logo_path, created_at FROM Bus_Company ORDER BY created_at DESC");
        $companies = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // For admin list include manager count and optionally manager details? We'll include manager_count
        foreach ($companies as &$c) {
            $countStmt = $db->prepare("SELECT COUNT(*) as cnt FROM User WHERE company_id = ?");
            $countStmt->execute([$c['id']]);
            $c['manager_count'] = (int)$countStmt->fetch(PDO::FETCH_ASSOC)['cnt'];
        }

        http_response_code(200);
        echo json_encode(['success' => true, 'data' => $companies, 'count' => count($companies)]);
        exit;
    }

    if ($method === 'POST') {
        // Create company or handle assign/remove manager actions
        $data = json_decode(file_get_contents('php://input'), true);

        // If action present and is assign/remove manager
        if ($companyId && $action === 'assign_manager') {
            if (empty($data['user_id'])) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'user_id gerekli']);
                exit;
            }

            // Verify company exists
            $cstmt = $db->prepare("SELECT id FROM Bus_Company WHERE id = ?");
            $cstmt->execute([$companyId]);
            if (!$cstmt->fetch()) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Firma bulunamadi']);
                exit;
            }

            // Verify user exists
            $ustmt = $db->prepare("SELECT id, role FROM User WHERE id = ?");
            $ustmt->execute([$data['user_id']]);
            $user = $ustmt->fetch(PDO::FETCH_ASSOC);
            if (!$user) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Kullanici bulunamadi']);
                exit;
            }

            // Do not allow assigning admin users as company managers
            if (isset($user['role']) && $user['role'] === 'admin') {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'Admin rolundeki kullanici firmaya atanamaz']);
                exit;
            }

            // Assign manager: set role to 'company' and company_id
            $up = $db->prepare("UPDATE User SET role = 'company', company_id = ? WHERE id = ?");
            $up->execute([$companyId, $data['user_id']]);

            http_response_code(200);
            echo json_encode(['success' => true, 'message' => 'Yonetici atandi']);
            exit;
        }

        if ($companyId && $action === 'remove_manager') {
            if (empty($data['user_id'])) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'user_id gerekli']);
                exit;
            }

            // Verify user exists and belongs to this company
            $ustmt = $db->prepare("SELECT id, role, company_id FROM User WHERE id = ?");
            $ustmt->execute([$data['user_id']]);
            $user = $ustmt->fetch(PDO::FETCH_ASSOC);
            if (!$user) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Kullanici bulunamadi']);
                exit;
            }

            if ($user['company_id'] !== $companyId) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'Kullanici bu firmaya ait degil']);
                exit;
            }

            if (isset($user['role']) && $user['role'] === 'admin') {
                $up = $db->prepare("UPDATE User SET company_id = NULL WHERE id = ?");
                $up->execute([$data['user_id']]);
            } else {
                $up = $db->prepare("UPDATE User SET role = 'user', company_id = NULL WHERE id = ?");
                $up->execute([$data['user_id']]);
            }

            http_response_code(200);
            echo json_encode(['success' => true, 'message' => 'Yonetici kaldirildi']);
            exit;
        }

        if (empty($data['name'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'name gerekli']);
            exit;
        }

        // Check unique name
        $chk = $db->prepare("SELECT id FROM Bus_Company WHERE name = ?");
        $chk->execute([$data['name']]);
        if ($chk->fetch()) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Bu firma adi zaten var']);
            exit;
        }

        // Generate UUID
        $uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );

        $logo = isset($data['logo_path']) ? $data['logo_path'] : null;
        $ins = $db->prepare("INSERT INTO Bus_Company (id, name, logo_path) VALUES (?, ?, ?)");
        $ins->execute([$uuid, $data['name'], $logo]);

        http_response_code(201);
        echo json_encode(['success' => true, 'message' => 'Firma olusturuldu', 'id' => $uuid]);
        exit;
    }

    if ($method === 'PATCH' || $method === 'PUT') {
        // Update company
        if (!$companyId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Firma id gerekli']);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
            exit;
        }

        $stmt = $db->prepare("SELECT id FROM Bus_Company WHERE id = ?");
        $stmt->execute([$companyId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Firma bulunamadi']);
            exit;
        }

        $fields = [];
        $params = [];
        if (isset($data['name'])) {
            $fields[] = 'name = ?';
            $params[] = $data['name'];
        }
        if (array_key_exists('logo_path', $data)) {
            $fields[] = 'logo_path = ?';
            $params[] = $data['logo_path'];
        }

        if (empty($fields)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Guncellenecek alan yok']);
            exit;
        }

        // Check unique name
        $chk = $db->prepare("SELECT id FROM Bus_Company WHERE name = ?");
        $chk->execute([$data['name']]);
        if ($chk->fetch()) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Bu firma adi zaten var']);
            exit;
        }

        $params[] = $companyId;
        $sql = "UPDATE Bus_Company SET " . implode(', ', $fields) . " WHERE id = ?";
        $up = $db->prepare($sql);
        $up->execute($params);

        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Firma guncellendi']);
        exit;
    }

    if ($method === 'DELETE') {
        if (!$companyId) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Firma id gerekli']);
            exit;
        }

        // Check exists
        $stmt = $db->prepare("SELECT id FROM Bus_Company WHERE id = ?");
        $stmt->execute([$companyId]);
        if (!$stmt->fetch()) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Firma bulunamadi']);
            exit;
        }

        // Begin transaction to refund passengers for upcoming trips, clean up related data, and delete the company
        $db->beginTransaction();

        // 1) Find upcoming trips for this company (departure_time in future)
        $tripsStmt = $db->prepare("SELECT id FROM Trips WHERE company_id = ? AND departure_time > datetime('now')");
        $tripsStmt->execute([$companyId]);
        $trips = $tripsStmt->fetchAll(PDO::FETCH_ASSOC);

        // Prepare statements for refund and cleanup
        $ticketStmt = $db->prepare("SELECT id, user_id, total_price FROM Tickets WHERE trip_id = ? AND status = 'active'");
        $updateBalance = $db->prepare("UPDATE User SET balance = COALESCE(balance, 0) + ? WHERE id = ?");
        $deleteBookedSeats = $db->prepare("DELETE FROM Booked_Seats WHERE ticket_id = ?");
        $cancelTicket = $db->prepare("UPDATE Tickets SET status = 'canceled' WHERE id = ?");
        $deleteTicket = $db->prepare("DELETE FROM Tickets WHERE id = ?");

        foreach ($trips as $t) {
            $tripId = $t['id'];
            // Get active tickets for this trip
            $ticketStmt->execute([$tripId]);
            $tickets = $ticketStmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($tickets as $tk) {
                // Refund: add total_price back to user's balance
                $price = (int)$tk['total_price'];
                $userId = $tk['user_id'];
                if ($price > 0) {
                    $updateBalance->execute([$price, $userId]);
                }

                // Remove booked seats for the ticket
                $deleteBookedSeats->execute([$tk['id']]);

                // Mark ticket as canceled (useful for audit) and then delete the ticket record
                // Marking as canceled first in case other systems read the cancellation before deletion
                $cancelTicket->execute([$tk['id']]);
                $deleteTicket->execute([$tk['id']]);
            }
        }

        // Delete trips belonging to this company (now that tickets/booked seats were removed)
        $delTrips = $db->prepare("DELETE FROM Trips WHERE company_id = ?");
        $delTrips->execute([$companyId]);

        // Demote or clear users assigned to this company
        $clear = $db->prepare("UPDATE User SET role = 'user', company_id = NULL WHERE company_id = ?");
        $clear->execute([$companyId]);

        // Finally delete the company
        $del = $db->prepare("DELETE FROM Bus_Company WHERE id = ?");
        $del->execute([$companyId]);

        $db->commit();

        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Firma silindi. Gerceklesmemis seferler için bilet alan yolculara ucretleri iade edildi.']);
        exit;
    }

    // Method not allowed
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Metod desteklenmiyor']);

} catch (PDOException $e) {
    if ($db->inTransaction()) $db->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Veritabani hatasi: ' . $e->getMessage()]);
} catch (Exception $e) {
    if ($db->inTransaction()) $db->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
}

?>
