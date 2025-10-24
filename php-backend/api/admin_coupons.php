<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../auth.php';

// Admin Coupons endpoint
// Admins can create global coupons (company_id = NULL) and manage only the coupons they created.
// Ownership is tracked in a lightweight JSON file to avoid schema changes.

$mappingFile = __DIR__ . '/../data/admin_coupons.json';

function load_admin_mapping($path) {
    if (!file_exists(dirname($path))) {
        @mkdir(dirname($path), 0777, true);
    }
    if (!file_exists($path)) {
        file_put_contents($path, json_encode(new stdClass()));
    }
    $raw = @file_get_contents($path);
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) return [];
    return $data;
}

function save_admin_mapping($path, $data) {
    $tmp = $path . '.tmp';
    $encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    file_put_contents($tmp, $encoded);
    @rename($tmp, $path);
}

$method = $_SERVER['REQUEST_METHOD'];
try {
    $payload = authenticateUser();
    if (!isset($payload['role']) || $payload['role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Sadece admin rolündeki kullanıcılar erişebilir']);
        exit;
    }

    $db = getDB();
    $adminId = $payload['user_id'];

    if ($method === 'GET') {
        // If id param provided, return single coupon if owned
        if (isset($_GET['id'])) {
            $id = $_GET['id'];
            $mapping = load_admin_mapping($mappingFile);
            if (!isset($mapping[$id]) || $mapping[$id] !== $adminId) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi veya yetkiniz yok']);
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
            echo json_encode(['success' => true, 'coupon' => $coupon]);
            exit;
        }

        // List all coupons owned by this admin
        $mapping = load_admin_mapping($mappingFile);
        $ownedIds = [];
        foreach ($mapping as $cid => $uid) {
            if ($uid === $adminId) $ownedIds[] = $cid;
        }
        if (empty($ownedIds)) {
            echo json_encode(['success' => true, 'coupons' => []]);
            exit;
        }
        $placeholders = implode(',', array_fill(0, count($ownedIds), '?'));
        $stmt = $db->prepare("SELECT c.*, (SELECT COUNT(*) FROM User_Coupons uc WHERE uc.coupon_id = c.id) AS used_count FROM Coupons c WHERE c.id IN ($placeholders) ORDER BY c.created_at DESC");
        $stmt->execute($ownedIds);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'coupons' => $rows]);
        exit;
    }

    if ($method === 'POST') {
        // Create a global coupon owned by this admin
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
        // Validate discount percentage (0-50)
        $dFloat = floatval($discount);
        if (!is_numeric($discount) || $dFloat < 0 || $dFloat > 50) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'discount alanı yüzde olarak girilmeli (0-50 arası)']);
            exit;
        }

        // Prevent duplicate global coupon code
        $dupStmt = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id IS NULL');
        $dupStmt->execute([$code]);
        $row = $dupStmt->fetch(PDO::FETCH_ASSOC);
        if ($row && intval($row['cnt']) > 0) {
            http_response_code(409);
            echo json_encode(['success' => false, 'error' => 'Ayni kodla baska bir kupon mevcut']);
            exit;
        }

        // Insert coupon with company_id = NULL
        $id = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0,0xffff),mt_rand(0,0xffff),mt_rand(0,0xffff), mt_rand(0,0x0fff)|0x4000, mt_rand(0,0x3fff)|0x8000, mt_rand(0,0xffff),mt_rand(0,0xffff),mt_rand(0,0xffff));
        $insert = $db->prepare('INSERT INTO Coupons (id, code, discount, company_id, usage_limit, expire_date) VALUES (?, ?, ?, NULL, ?, ?)');
        $insert->execute([$id, $code, (float)$discount, $usage_limit, $expire_date]);

        // Record ownership in mapping file
        $mapping = load_admin_mapping($mappingFile);
        $mapping[$id] = $adminId;
        save_admin_mapping($mappingFile, $mapping);

        http_response_code(201);
        echo json_encode(['success' => true, 'coupon' => ['id' => $id, 'code' => $code, 'discount' => (float)$discount, 'company_id' => null, 'usage_limit' => (int)$usage_limit, 'expire_date' => $expire_date]]);
        exit;
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        if (!isset($_GET['id'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Kupon id parametresi gerekli']);
            exit;
        }
        $id = $_GET['id'];
        $mapping = load_admin_mapping($mappingFile);
        if (!isset($mapping[$id]) || $mapping[$id] !== $adminId) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi veya yetkiniz yok']);
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
            // check duplicate among global coupons (excluding this one)
            $d = $db->prepare('SELECT COUNT(*) as cnt FROM Coupons WHERE code = ? AND company_id IS NULL AND id != ?');
            $d->execute([$newCode, $id]);
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
        $mapping = load_admin_mapping($mappingFile);
        if (!isset($mapping[$id]) || $mapping[$id] !== $adminId) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Kupon bulunamadi veya yetkiniz yok']);
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

        $d = $db->prepare('DELETE FROM Coupons WHERE id = ?');
        $d->execute([$id]);

        // Remove mapping
        unset($mapping[$id]);
        save_admin_mapping($mappingFile, $mapping);

        echo json_encode(['success' => true, 'message' => 'Kupon silindi']);
        exit;
    }

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
