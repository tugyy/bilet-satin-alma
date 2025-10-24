<?php
require_once '../config.php';
require_once '../auth.php';

/**
 * @OA\Post(
 *     path="/api/auth.php",
 *     summary="Kullanıcı girişi yap",
 *     @OA\RequestBody(
 *         required=true,
 *         @OA\JsonContent(
 *             @OA\Property(property="email", type="string", format="email"),
 *             @OA\Property(property="password", type="string", format="password")
 *         )
 *     ),
 *     @OA\Response(
 *         response="200",
 *         description="Giriş başarılı",
 *         @OA\JsonContent(
 *             @OA\Property(property="success", type="boolean"),
 *             @OA\Property(property="message", type="string"),
 *             @OA\Property(property="token", type="string"),
 *             @OA\Property(property="user", type="object")
 *         )
 *     ),
 *     @OA\Response(
 *         response="401",
 *         description="Giriş başarısız",
 *         @OA\JsonContent(
 *             @OA\Property(property="success", type="boolean"),
 *             @OA\Property(property="error", type="string")
 *         )
 *     )
 * )
 * @OA\Delete(
 *     path="/api/auth.php",
 *     summary="Kullanıcı çıkışı yap",
 *     security={{"bearerAuth": {}}},
 *     @OA\Response(
 *         response="200",
 *         description="Çıkış başarılı",
 *         @OA\JsonContent(
 *             @OA\Property(property="success", type="boolean"),
 *             @OA\Property(property="message", type="string")
 *         )
 *     ),
 *     @OA\Response(
 *         response="401",
 *         description="Yetkilendirme hatası",
 *         @OA\JsonContent(
 *             @OA\Property(property="success", type="boolean"),
 *             @OA\Property(property="error", type="string")
 *         )
 *     )
 * )
 * @OA\Info(title="API Title", version="1.0.0")
 */

$method = $_SERVER['REQUEST_METHOD'];

// Handle login (POST)
if ($method === 'POST') {
    try {
        $data = json_decode(file_get_contents('php://input'), true);
        
        // Validate required fields
        if (empty($data['email']) || empty($data['password'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'Email ve sifre gerekli'
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
        
        $db = getDB();
        
    // Get user from database
    // Include company_id and balance so frontend receives these on successful login
    $stmt = $db->prepare("SELECT id, full_name, email, role, company_id, balance, password FROM User WHERE email = ?");
        $stmt->execute([$data['email']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$user) {
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'error' => 'Gecersiz email veya sifre'
            ]);
            exit;
        }
        
        // Verify password
        if (!password_verify($data['password'], $user['password'])) {
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'error' => 'Gecersiz email veya sifre'
            ]);
            exit;
        }
        
        // Generate JWT token
        $payload = [
            'user_id' => $user['id'],
            'email' => $user['email'],
            'role' => $user['role'],
            'iat' => time(),
            'exp' => time() + (24 * 60 * 60) // 24 hours
        ];
        
        $token = generateJWT($payload);
        
        // Remove password from response
        unset($user['password']);
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'message' => 'Giris basarili',
            'token' => $token,
            'user' => $user
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

// Handle profile retrieval (GET) and update (PATCH)
elseif ($method === 'GET') {
    try {
        // Authenticate user
        $payload = authenticateUser();

        $db = getDB();

        // Fetch user by id from token
        $stmt = $db->prepare("SELECT id, full_name, email, role, company_id, balance, created_at FROM User WHERE id = ?");
        $stmt->execute([$payload['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'error' => 'Kullanici bulunamadi'
            ]);
            exit;
        }

        http_response_code(200);
        echo json_encode([
            'success' => true,
            'user' => $user
        ]);

    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Sunucu hatasi: ' . $e->getMessage()
        ]);
    }

} elseif ($method === 'PATCH') {
    try {
        // Authenticate user
        $payload = authenticateUser();

        // Prevent admin users from updating their own info via this endpoint
        if (isset($payload['role']) && $payload['role'] === 'admin') {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'error' => 'Admin kullanicisi kendi bilgilerini guncelleyemez'
            ]);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);

        if (!is_array($data) || empty($data)) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'Guncellenecek alanlar gerekli'
            ]);
            exit;
        }

    // Only allow updating these fields from this endpoint
    $allowed = ['full_name', 'email', 'password'];
        $fields = [];
        $values = [];

        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                // validate
                if ($field === 'email' && !filter_var($data[$field], FILTER_VALIDATE_EMAIL)) {
                    http_response_code(400);
                    echo json_encode(['success' => false, 'error' => 'Geçersiz email formatı']);
                    exit;
                }
                if ($field === 'balance') {
                    if (!is_numeric($data[$field]) || $data[$field] < 0) {
                        http_response_code(400);
                        echo json_encode(['success' => false, 'error' => 'Balance negatif olamaz']);
                        exit;
                    }
                }

                if ($field === 'password') {
                    // hash password
                    $fields[] = "password = ?";
                    $values[] = password_hash($data[$field], PASSWORD_DEFAULT);
                } else {
                    $fields[] = "$field = ?";
                    $values[] = $data[$field];
                }
            }
        }

        if (empty($fields)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Guncellenecek geçerli alan yok']);
            exit;
        }

        $db = getDB();

        // If email provided, ensure it's not used by another user
        if (isset($data['email'])) {
            $stmt = $db->prepare("SELECT id FROM User WHERE email = ? AND id != ?");
            $stmt->execute([$data['email'], $payload['user_id']]);
            if ($stmt->fetch()) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'Bu email zaten kullanimda']);
                exit;
            }
        }

        $values[] = $payload['user_id'];
        $sql = "UPDATE User SET " . implode(', ', $fields) . " WHERE id = ?";

        $stmt = $db->prepare($sql);
        $stmt->execute($values);

        // Return updated user
        $stmt = $db->prepare("SELECT id, full_name, email, role, company_id, balance, created_at FROM User WHERE id = ?");
        $stmt->execute([$payload['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        http_response_code(200);
        echo json_encode([
            'success' => true,
            'message' => 'Kullanici başarıyla guncellendi',
            'user' => $user
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

// Handle logout (DELETE)
} elseif ($method === 'DELETE') {
    try {
        // Authenticate user first
        $payload = authenticateUser();
        
        // For JWT-based logout, we don't need to store anything in database
        // The client should simply discard the token
        // In a more advanced implementation, you could maintain a blacklist of tokens
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'message' => 'Çikis basarili. Token artik geçersizdir.'
        ]);
        
    } catch (Exception $e) {
        // authenticateUser() already handles error responses
        // This catch block is here for any other potential errors
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Sunucu hatası: ' . $e->getMessage()
        ]);
    }
}

// Handle unsupported methods
else {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error' => 'Desteklenen metodlar: POST (giris), GET (profil), PATCH (guncelle), DELETE (cikis)'
    ]);
}
?>

