<?php
require_once '../config.php';
require_once '../auth.php';

/**
 * POST /api/register.php
 * body: { full_name, email, password }
 */

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error' => 'Desteklenen metodlar: POST'
    ]);
    exit;
}

try {
    $data = json_decode(file_get_contents('php://input'), true);

    if (!is_array($data)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Gecersiz JSON']);
        exit;
    }

    // Validate required fields
    if (empty($data['full_name']) || empty($data['email']) || empty($data['password'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'full_name, email ve password gerekli']);
        exit;
    }

    if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Gecersiz email formati']);
        exit;
    }

    // Password minimal validation
    if (strlen($data['password']) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Sifre en az 6 karakter olmali']);
        exit;
    }

    $db = getDB();

    // Check existing email
    $stmt = $db->prepare("SELECT id FROM User WHERE email = ?");
    $stmt->execute([$data['email']]);
    if ($stmt->fetch()) {
        http_response_code(409);
        echo json_encode(['success' => false, 'error' => 'Bu email zaten kullaniliyor']);
        exit;
    }

    // Generate UUID v4
    $uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );

    $role = 'user';
    $balance = 800.0;

    $hashed = password_hash($data['password'], PASSWORD_DEFAULT);

    $insert = $db->prepare("INSERT INTO User (id, full_name, email, role, password, balance) VALUES (?, ?, ?, ?, ?, ?)");
    $insert->execute([$uuid, $data['full_name'], $data['email'], $role, $hashed, $balance]);

    // Build payload and token
    $payload = [
        'user_id' => $uuid,
        'email' => $data['email'],
        'role' => $role,
        'iat' => time(),
        'exp' => time() + (24 * 60 * 60)
    ];

    $token = generateJWT($payload);

    // Return created user (without password)
    http_response_code(201);
    echo json_encode([
        'success' => true,
        'message' => 'Kayit basarili'
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Veritabani hatasi: ' . $e->getMessage()]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
}

?>
