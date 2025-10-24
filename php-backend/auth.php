<?php
require_once 'config.php';

/**
 * JWT Authentication Helper Functions
 */

// JWT Secret Key - In production, this should be stored securely
define('JWT_SECRET', 'SIBER_YAVUZLAR_SECRET_KEY_1234567890');
define('JWT_ALGORITHM', 'HS256');

/**
 * Generate JWT token
 */
function generateJWT($payload) {
    $header = json_encode(['typ' => 'JWT', 'alg' => JWT_ALGORITHM]);
    $payload = json_encode($payload);
    
    $base64Header = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64Payload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($payload));
    
    $signature = hash_hmac('sha256', $base64Header . "." . $base64Payload, JWT_SECRET, true);
    $base64Signature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
    
    return $base64Header . "." . $base64Payload . "." . $base64Signature;
}

/**
 * Verify JWT token
 */
function verifyJWT($token) {
    $tokenParts = explode('.', $token);
    
    if (count($tokenParts) !== 3) {
        return false;
    }
    
    list($base64Header, $base64Payload, $base64Signature) = $tokenParts;
    
    $signature = hash_hmac('sha256', $base64Header . "." . $base64Payload, JWT_SECRET, true);
    $expectedSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
    
    if (!hash_equals($expectedSignature, $base64Signature)) {
        return false;
    }
    
    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64Payload)), true);
    
    // Check if token is expired
    if (isset($payload['exp']) && $payload['exp'] < time()) {
        return false;
    }
    
    return $payload;
}

/**
 * Get Authorization header
 */
function getAuthorizationHeader() {
    $headers = null;
    if (isset($_SERVER['Authorization'])) {
        $headers = trim($_SERVER["Authorization"]);
    } else if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $headers = trim($_SERVER["HTTP_AUTHORIZATION"]);
    } else if (function_exists('apache_request_headers')) {
        $requestHeaders = apache_request_headers();
        $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
        if (isset($requestHeaders['Authorization'])) {
            $headers = trim($requestHeaders['Authorization']);
        }
    }
    return $headers;
}

/**
 * Get Bearer token from Authorization header
 */
function getBearerToken() {
    $headers = getAuthorizationHeader();
    if (!empty($headers)) {
        if (preg_match('/Bearer\s(\S+)/', $headers, $matches)) {
            return $matches[1];
        }
    }
    return null;
}

/**
 * Authenticate user and check if they are admin
 */
function authenticateAdmin() {
    $token = getBearerToken();
    
    if (!$token) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'Authorization token gerekli'
        ]);
        exit;
    }
    
    $payload = verifyJWT($token);
    
    if (!$payload) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'Geçersiz veya süresi dolmuş token'
        ]);
        exit;
    }
    
    // Check if user is admin
    if (!isset($payload['role']) || $payload['role'] !== 'admin') {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error' => 'Bu işlem için admin yetkisi gerekli'
        ]);
        exit;
    }
    
    return $payload;
}

/**
 * Authenticate user (any role)
 */
function authenticateUser() {
    $token = getBearerToken();
    
    if (!$token) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'Authorization token gerekli'
        ]);
        exit;
    }
    
    $payload = verifyJWT($token);
    
    if (!$payload) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error' => 'Geçersiz veya süresi dolmuş token'
        ]);
        exit;
    }
    
    return $payload;
}

/**
 * Check whether a given payload belongs to a company manager for a company id
 * Returns true/false. Does not exit on failure.
 */
function isUserCompanyManagerOf($payload, $companyId) {
    if (!is_array($payload) || !isset($payload['user_id'])) return false;
    if (!isset($payload['role']) || $payload['role'] !== 'company') return false;

    try {
        $db = getDB();
        $stmt = $db->prepare("SELECT company_id FROM User WHERE id = ?");
        $stmt->execute([$payload['user_id']]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) return false;
        return ($user['company_id'] === $companyId);
    } catch (Exception $e) {
        return false;
    }
}

/**
 * Ensure the current authenticated user is a company manager for the provided company id.
 * On failure this function will send an HTTP error response and exit.
 * Returns the authenticated payload on success.
 */
function ensureUserIsCompanyManagerForCompany($companyId) {
    $payload = authenticateUser();
    if (!isUserCompanyManagerOf($payload, $companyId)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Bu işlem için firma yöneticisi olmalısınız']);
        exit;
    }
    return $payload;
}

/**
 * Ensure the current authenticated user is a company manager for the company that owns the trip id.
 * On success returns an array with ['payload' => ..., 'trip' => tripRow]
 */
function ensureUserIsCompanyManagerForTrip($tripId) {
    $payload = authenticateUser();
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM Trips WHERE id = ?");
    $stmt->execute([$tripId]);
    $trip = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$trip) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Sefer bulunamadi']);
        exit;
    }
    if (!isUserCompanyManagerOf($payload, $trip['company_id'])) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Bu sefer üzerinde işlem yapma yetkiniz yok']);
        exit;
    }
    return ['payload' => $payload, 'trip' => $trip];
}
?>

