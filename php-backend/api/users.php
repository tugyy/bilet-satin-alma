<?php
require_once '../config.php';
require_once '../auth.php';

/**
 * @OA.Post(
 *     path="/api/users.php",
 *     summary="Yeni kullanıcı oluştur",
 *     @OA.RequestBody(
 *         @OA.JsonContent(
 *             @OA.Property(property="full_name", type="string"),
 *             @OA.Property(property="email", type="string"),
 *             @OA.Property(property="role", type="string", enum={"user", "company", "admin"})
 *         )
 *     ),
 *     @OA.Response(response="200", description="Kullanıcı oluşturuldu")
 * )
 *             @OA\Property(property="password", type="string")
 *         )
 *     ),
 *     @OA\Response(response="200", description="Kullanıcı oluşturuldu")
 * )
 */

$db = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// Admin authentication required for all user operations
authenticateAdmin();

if ($method == 'GET') {
    try {
        // Do not return sensitive or unnecessary fields like balance and created_at from this admin listing endpoint.
        // Exclude users with role 'admin' from this listing
        $users = $db->query("SELECT id, full_name, email, role, company_id FROM User WHERE role != 'admin'")->fetchAll(PDO::FETCH_ASSOC);
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $users,
            'count' => count($users)
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Veritabani hatasi: ' . $e->getMessage()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Sunucu hatasi: ' . $e->getMessage()
        ]);
    }
}

if ($method == 'POST') {
    try {
    $data = json_decode(file_get_contents('php://input'), true);
    
        // Validate required fields (password is set by the server to a default for admin-created users)
        // Role and balance must NOT be provided by clients for this endpoint; server enforces them.
        if (empty($data['full_name']) || empty($data['email'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'Eksik alanlar: full_name ve email gerekli'
            ]);
            exit;
        }
        
        // Validate email format
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'Gecersiz email formati'
            ]);
            exit;
        }
        
        // Do NOT accept 'role' or 'balance' from clients when creating users here.
        if (isset($data['role'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => "Bu endpoint uzerinden 'role' gonderemezsiniz. Rol server tarafindan atanir."
            ]);
            exit;
        }

        if (isset($data['balance'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => "Bu endpoint uzerinden 'balance' gonderemezsiniz. Bakiye server tarafindan atanir."
            ]);
            exit;
        }
        
        // Check if email already exists
        $checkStmt = $db->prepare("SELECT id FROM User WHERE email = ?");
        $checkStmt->execute([$data['email']]);
        if ($checkStmt->fetch()) {
            http_response_code(409);
            echo json_encode([
                'success' => false,
                'error' => 'Bu email adresi zaten kullaniliyor'
            ]);
            exit;
        }
        
    // Server-side default balance for new users
    $balance = 800.0;

        // Generate UUID v4
        $uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );
        // For this endpoint: users created here must be company admins only.
        // Ignore any client-provided 'role' and set role to 'company' (company admin).
        $roleToInsert = 'company';

        // Require company_id to be provided for company admin users
        if (empty($data['company_id'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'company_id gerekli!'
            ]);
            exit;
        }

        // Verify the provided company exists
        $cstmt = $db->prepare("SELECT id FROM Bus_Company WHERE id = ?");
        $cstmt->execute([$data['company_id']]);
        if (!$cstmt->fetch()) {
            http_response_code(404);
            echo json_encode([
                'success' => false,
                'error' => 'Belirtilen company_id bulunamadi'
            ]);
            exit;
        }

        // Use a fixed default password for users created by admin
        $defaultPassword = 'temppassword';
        $stmt = $db->prepare("INSERT INTO User (id, full_name, email, role, password, balance, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$uuid, $data['full_name'], $data['email'], $roleToInsert, password_hash($defaultPassword, PASSWORD_DEFAULT), $balance, $data['company_id']]);
        
        http_response_code(201);
        echo json_encode([
            'success' => true,
            'message' => 'Kullanici basariyla olusturuldu',
            'id' => $uuid
        ]);
        
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Veritabani hatasi: ' . $e->getMessage()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Sunucu hatasi: ' . $e->getMessage()
        ]);
    }
}

// Note: DELETE and PATCH handlers removed. User deletion and editing
// must be implemented in separate, dedicated admin endpoints.
?>