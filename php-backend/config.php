<?php

define('DB_PATH', __DIR__ . '/db/database.sqlite');

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS');
// Allow Authorization for protected endpoints and common headers used by fetch requests
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Respond to CORS preflight requests immediately
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    // No content needed for preflight; headers above are sufficient
    http_response_code(204);
    exit;
}

function getDB() {
    // Ensure db directory exists
    $dbDir = dirname(DB_PATH);
    if (!is_dir($dbDir)) {
        mkdir($dbDir, 0777, true);
    }

    $needInit = !file_exists(DB_PATH);

    try {
        $db = new PDO('sqlite:' . DB_PATH);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // Ensure foreign key constraints are enforced
        $db->exec('PRAGMA foreign_keys = ON;');

        // If DB already existed, attempt lightweight migration: ensure Tickets has coupon_id column
        try {
            $hasTickets = $db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='Tickets'")->fetchColumn();
            if ($hasTickets) {
                $cols = $db->query("PRAGMA table_info('Tickets')")->fetchAll(PDO::FETCH_ASSOC);
                $found = false;
                foreach ($cols as $col) {
                    if (isset($col['name']) && $col['name'] === 'coupon_id') { $found = true; break; }
                }
                if (!$found) {
                    // Add nullable coupon_id column to Tickets to store applied coupon reference
                    $db->exec("ALTER TABLE Tickets ADD COLUMN coupon_id TEXT;");
                    // Note: adding foreign key constraint in-place on SQLite is non-trivial; we only add column for lookups
                }
            }
        } catch (Exception $e) {
            // If migration fails, continue silently; existing DB will still work but coupon features may be limited
        }

        if ($needInit) {
            // Initialize schema
            $schema = <<<'SQL'
-- User tablosu
CREATE TABLE User (
    id TEXT PRIMARY KEY,
    full_name TEXT,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'company', 'admin')),
    password TEXT NOT NULL,
    company_id TEXT,
    balance INTEGER DEFAULT 800,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES Bus_Company(id)
);

-- Bus_Company tablosu
CREATE TABLE Bus_Company (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    logo_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trips tablosu
CREATE TABLE Trips (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    destination_city TEXT NOT NULL,
    arrival_time DATETIME NOT NULL,
    departure_time DATETIME NOT NULL,
    departure_city TEXT NOT NULL,
    price INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES Bus_Company(id)
);

-- Tickets tablosu
CREATE TABLE Tickets (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active', 'canceled', 'expired')),
    total_price INTEGER NOT NULL,
    -- Optional reference to applied coupon (nullable)
    coupon_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trip_id) REFERENCES Trips(id),
    FOREIGN KEY (user_id) REFERENCES User(id)
    -- Note: SQLite does not support adding a FK easily in migrations; coupon_id is stored for lookup
);

-- Booked_Seats tablosu
CREATE TABLE Booked_Seats (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES Tickets(id),
    UNIQUE(ticket_id, seat_number)
);

-- Coupons tablosu
CREATE TABLE Coupons (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    discount REAL NOT NULL,
    company_id TEXT,
    usage_limit INTEGER NOT NULL,
    expire_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES Bus_Company(id)
);

-- User_Coupons tablosu
CREATE TABLE User_Coupons (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coupon_id) REFERENCES Coupons(id),
    FOREIGN KEY (user_id) REFERENCES User(id),
    UNIQUE(coupon_id, user_id)
);

-- İndeksler (performans için)
CREATE INDEX idx_user_email ON User(email);
CREATE INDEX idx_user_company ON User(company_id);
CREATE INDEX idx_trips_company ON Trips(company_id);
CREATE INDEX idx_trips_dates ON Trips(departure_time, arrival_time);
CREATE INDEX idx_tickets_user ON Tickets(user_id);
CREATE INDEX idx_tickets_trip ON Tickets(trip_id);
CREATE INDEX idx_booked_seats_ticket ON Booked_Seats(ticket_id);
CREATE INDEX idx_coupons_code ON Coupons(code);
CREATE INDEX idx_coupons_company ON Coupons(company_id);
SQL;

            try {
                $db->beginTransaction();

                // Split statements and execute individually to provide clearer errors
                $statements = array_filter(array_map('trim', explode(';', $schema)));
                foreach ($statements as $statement) {
                    if ($statement === '') continue;
                    $db->exec($statement . ';');
                }

                // After creating schema, insert a default admin user if no users exist
                // Default credentials: email: user@example.com, password: string, full_name: Admin
                // balance should be NULL for the admin user as requested
                $check = $db->query("SELECT COUNT(*) as cnt FROM User");
                $row = $check->fetch(PDO::FETCH_ASSOC);
                if ($row && intval($row['cnt']) === 0) {
                    // Generate UUID v4 (same method as register.php)
                    $uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
                        mt_rand(0, 0xffff),
                        mt_rand(0, 0x0fff) | 0x4000,
                        mt_rand(0, 0x3fff) | 0x8000,
                        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
                    );

                    $email = 'admin@example.com';
                    $passwordPlain = 'string';
                    $fullName = 'Admin';
                    $role = 'admin';
                    $hashed = password_hash($passwordPlain, PASSWORD_DEFAULT);

                    $insertAdmin = $db->prepare("INSERT INTO User (id, full_name, email, role, password, balance) VALUES (?, ?, ?, ?, ?, ?)");
                    // Use NULL for balance explicitly
                    $insertAdmin->execute([$uuid, $fullName, $email, $role, $hashed, null]);
                }

                $db->commit();
            } catch (Exception $e) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                // Remove incomplete DB file if created
                if (file_exists(DB_PATH)) {
                    @unlink(DB_PATH);
                }
                echo json_encode([
                    'status' => 'error',
                    'message' => 'Veritabani olusturulurken hata: ' . $e->getMessage()
                ]);
                exit;
            }
        }

        return $db;
    } catch (PDOException $e) {
        echo json_encode([
            'status' => 'error',
            'message' => 'Veritabanina baglanilamadi: ' . $e->getMessage()
        ]);
        exit;
    }
}

if (php_sapi_name() === 'cli' && basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'])) {
    $db = getDB();
    echo json_encode(['status' => 'success', 'message' => 'Veritabanina basariyla baglanildi.']);
}
