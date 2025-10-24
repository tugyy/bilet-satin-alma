<?php
require_once '../config.php';
require_once '../auth.php';

// Coupons API
// Supports company-scoped CRUD operations for coupons.
// - GET (list):         GET /api/coupons.php?company_id=...      (company manager or admin)
// - GET (single):       GET /api/coupons.php?id=...            (company manager or admin)
// - POST (create):      POST /api/coupons.php                 (company manager or admin)
// - PUT (update):       PUT /api/coupons.php?id=...           (company manager or admin)
// - DELETE (delete):    DELETE /api/coupons.php?id=...        (company manager or admin)

// Helper: generate UUID v4
function generate_uuid_v4() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

// Helper: get authenticated payload (or send 401)
function get_auth_payload_or_401() {
    $token = getBearerToken();
    if (!$token) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Authorization token gerekli']);
        exit;
    }
    $payload = verifyJWT($token);
    if (!$payload) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Geçersiz veya süresi dolmuş token']);
        exit;
    }
    return $payload;
}

// Helper: check whether payload has access to company (admin or company manager of that company)
// Ensure payload is a company manager for the given company.
// This enforces that only users with role='company' can manage coupons for their own company.
function ensure_payload_is_company_manager($payload, $companyId) {
    if (!is_array($payload)) return false;
    if (!isset($payload['role']) || $payload['role'] !== 'company') return false;
    return isUserCompanyManagerOf($payload, $companyId);
}

$method = $_SERVER['REQUEST_METHOD'];

try {
    $db = getDB();

    if ($method === 'GET') {
        // Single coupon by id
        if (isset($_GET['id'])) {
            $id = $_GET['id'];
            $stmt = $db->prepare('SELECT * FROM Coupons WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            $coupon = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$coupon) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi']);
                exit;
            }

            // auth: only company managers may access coupon details for their own company
            $payload = get_auth_payload_or_401();
            if (empty($coupon['company_id'])) {
                // Global coupons (company_id NULL) are not manageable by company users
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Bu kuponu görme yetkiniz yok']);
                exit;
            }
            if (!ensure_payload_is_company_manager($payload, $coupon['company_id'])) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Bu kuponu görme yetkiniz yok']);
                exit;
            }

            echo json_encode(['success' => true, 'coupon' => $coupon]);
            exit;
        }

        // List coupons for the authenticated company manager's company.
        // Company managers may only list coupons for their own company; admin is not allowed here.
        $payload = get_auth_payload_or_401();
        if (!isset($payload['role']) || $payload['role'] !== 'company') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Bu işlemi yapmak için company rolünde olmalısınız']);
            exit;
        }

        // Resolve user's company id
        $ustmt = $db->prepare('SELECT company_id FROM User WHERE id = ?');
        $ustmt->execute([$payload['user_id']]);
        $user = $ustmt->fetch(PDO::FETCH_ASSOC);
        $userCompany = $user ? $user['company_id'] : null;
        if (!$userCompany) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Firma yöneticisi için şirket bilgisi yok']);
            exit;
        }

        // Support optional pagination
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : null;
        $offset = isset($_GET['offset']) ? (int)$_GET['offset'] : null;

    // Include used_count (how many times the coupon was consumed) for frontend display
    $sql = 'SELECT c.*, (SELECT COUNT(*) FROM User_Coupons uc WHERE uc.coupon_id = c.id) AS used_count FROM Coupons c WHERE c.company_id = ? ORDER BY c.created_at DESC';
        if ($limit !== null && $offset !== null) {
            $sql .= ' LIMIT ' . max(0, $limit) . ' OFFSET ' . max(0, $offset);
        } elseif ($limit !== null) {
            $sql .= ' LIMIT ' . max(0, $limit);
        }

        $stmt = $db->prepare($sql);
        $stmt->execute([$userCompany]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'coupons' => $rows]);
        exit;
    }

    if ($method === 'POST') {
        $payload = get_auth_payload_or_401();

        // Only company role can create coupons for their own company
        if (!isset($payload['role']) || $payload['role'] !== 'company') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Sadece company rolündeki kullanıcılar kupon oluşturabilir']);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
            exit;
        }

        $code = isset($data['code']) ? trim($data['code']) : null;
    $discount = isset($data['discount']) ? $data['discount'] : null;
        $usage_limit = isset($data['usage_limit']) ? (int)$data['usage_limit'] : null;
        $expire_date = isset($data['expire_date']) ? $data['expire_date'] : null;

        if (!$code || $discount === null || $usage_limit === null || !$expire_date) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Gerekli alanlar: code, discount, usage_limit, expire_date']);
            exit;
        }

        // Validate discount as percentage and enforce max 50%
        $dFloat = floatval($discount);
        if (!is_numeric($discount) || $dFloat < 0 || $dFloat > 50) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'discount alanı yüzde olarak girilmeli (0-50 arası)']);
            exit;
        }

        // fetch user's company_id and enforce it
        $stmt = $db->prepare('SELECT company_id FROM User WHERE id = ?');
        $stmt->execute([$payload['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        $userCompany = $user ? $user['company_id'] : null;
        if (!$userCompany) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Firma yöneticisi için company_id yok']);
            exit;
        }
        $company_id = $userCompany;

        // Prevent duplicate code for same company scope
        if ($company_id === null) {
            $dupStmt = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id IS NULL');
            $dupStmt->execute([$code]);
        } else {
            $dupStmt = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id = ?');
            $dupStmt->execute([$code, $company_id]);
        }
        $row = $dupStmt->fetch(PDO::FETCH_ASSOC);
        if ($row && intval($row['cnt']) > 0) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Ayni kodla baska bir kupon mevcut']);
            exit;
        }

        // Insert
        $id = generate_uuid_v4();
    $insert = $db->prepare('INSERT INTO Coupons (id, code, discount, company_id, usage_limit, expire_date) VALUES (?, ?, ?, ?, ?, ?)');
    $insert->execute([$id, $code, (float)$discount, $company_id, $usage_limit, $expire_date]);

        http_response_code(201);
        echo json_encode(['success' => true, 'coupon' => [
            'id' => $id,
            'code' => $code,
            'discount' => (float)$discount,
            'company_id' => $company_id,
            'usage_limit' => (int)$usage_limit,
            'expire_date' => $expire_date
        ]]);
        exit;
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        // update coupon by id
        if (!isset($_GET['id'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Kupon id parametresi gerekli']);
            exit;
        }
        $id = $_GET['id'];
        $payload = get_auth_payload_or_401();

        // Only company managers can update coupons for their own company
        if (!isset($payload['role']) || $payload['role'] !== 'company') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Sadece company rolündeki kullanıcılar kupon güncelleyebilir']);
            exit;
        }
        $stmt = $db->prepare('SELECT * FROM Coupons WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $coupon = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$coupon) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi']);
            exit;
        }

        // Coupon must belong to a company and match the user's company
        if (empty($coupon['company_id'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Bu kupon üzerinde işlem yapma yetkiniz yok']);
            exit;
        }
        if (!ensure_payload_is_company_manager($payload, $coupon['company_id'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Bu kupon üzerinde işlem yapma yetkiniz yok']);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        if (!is_array($data)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
            exit;
        }

        $fields = [];
        $params = [];

        if (isset($data['code'])) {
            $newCode = trim($data['code']);
            // check duplicate same company
            if ($coupon['company_id'] === null) {
                $d = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id IS NULL AND id != ?');
                $d->execute([$newCode, $id]);
            } else {
                $d = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id = ? AND id != ?');
                $d->execute([$newCode, $coupon['company_id'], $id]);
            }
            $r = $d->fetch(PDO::FETCH_ASSOC);
            if ($r && intval($r['cnt']) > 0) {
                http_response_code(409);
                echo json_encode(['success' => false, 'error' => 'Ayni kodla baska bir kupon mevcut']);
                exit;
            }
            $fields[] = 'code = ?';
            $params[] = $newCode;
        }

        if (isset($data['discount'])) {
            // validate discount on update as well (percentage 0-50)
            $dUpdate = floatval($data['discount']);
            if (!is_numeric($data['discount']) || $dUpdate < 0 || $dUpdate > 50) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'discount alanı yüzde olarak girilmeli (0-50 arası)']);
                exit;
            }
            $fields[] = 'discount = ?';
            $params[] = (float)$data['discount'];
        }
        if (isset($data['usage_limit'])) {
            $fields[] = 'usage_limit = ?';
            $params[] = (int)$data['usage_limit'];
        }
        if (isset($data['expire_date'])) {
            $fields[] = 'expire_date = ?';
            $params[] = $data['expire_date'];
        }

        // Do not allow changing company_id from this endpoint (only company's own coupons can be edited)
        if (isset($data['company_id'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'company_id bu endpoint üzerinden değiştirilemez']);
            exit;
        }

        if (count($fields) === 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Guncellenecek alan yok']);
            exit;
        }

        $params[] = $id;
        $sql = 'UPDATE Coupons SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $upd = $db->prepare($sql);
        $upd->execute($params);

        echo json_encode(['success' => true, 'message' => 'Kupon guncellendi']);
        exit;
    }

    if ($method === 'DELETE') {
        if (!isset($_GET['id'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Kupon id parametresi gerekli']);
            exit;
        }
        $id = $_GET['id'];
        $payload = get_auth_payload_or_401();
        // Only company managers can delete coupons for their own company
        if (!isset($payload['role']) || $payload['role'] !== 'company') {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Sadece company rolündeki kullanıcılar kupon silebilir']);
            exit;
        }

        $stmt = $db->prepare('SELECT * FROM Coupons WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $coupon = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$coupon) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi']);
            exit;
        }

        if (empty($coupon['company_id']) || !ensure_payload_is_company_manager($payload, $coupon['company_id'])) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Bu kuponu silme yetkiniz yok']);
            exit;
        }

        $d = $db->prepare('DELETE FROM Coupons WHERE id = ?');
        $d->execute([$id]);

        echo json_encode(['success' => true, 'message' => 'Kupon silindi']);
        exit;
    }

    // Method not allowed
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Metod desteklenmiyor']);
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
