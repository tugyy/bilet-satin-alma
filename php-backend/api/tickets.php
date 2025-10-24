<?php
require_once '../config.php';
require_once '../auth.php';

$method = $_SERVER['REQUEST_METHOD'];

try {
    // Check for path after tickets.php (for /tickets.php/{id}/pdf)
    $uriAfter = '';
    $uriFull = $_SERVER['REQUEST_URI'];
    $pos = strpos($uriFull, 'tickets.php');
    if ($pos !== false) {
        $uriAfter = substr($uriFull, $pos + strlen('tickets.php'));
        $uriAfter = trim($uriAfter, '/');
    }

    // If GET and uriAfter contains something like {id}/pdf or {id}/download, handle PDF generation
    if ($method === 'GET' && $uriAfter !== '') {
        $parts = explode('/', $uriAfter);
        $ticketId = $parts[0] ?? null;
        $action = $parts[1] ?? null; // expecting 'pdf' or 'download'
        if ($ticketId && ($action === 'pdf' || $action === 'download')) {
            // Authenticate user
            $payload = authenticateUser();
            $db = getDB();

            // Load ticket and related trip/company/user info
            $stmt = $db->prepare("SELECT tk.id as ticket_id, tk.trip_id, tk.user_id, tk.total_price, tk.status, tk.created_at, t.departure_time, t.arrival_time, t.departure_city, t.destination_city, t.price as seat_price, t.company_id, bc.name as company_name, bc.logo_path as company_logo, u.full_name AS owner_name, u.email AS owner_email FROM Tickets tk LEFT JOIN Trips t ON t.id = tk.trip_id LEFT JOIN Bus_Company bc ON bc.id = t.company_id LEFT JOIN User u ON u.id = tk.user_id WHERE tk.id = ? LIMIT 1");
            $stmt->execute([$ticketId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                http_response_code(404);
                echo json_encode(['success' => false, 'error' => 'Bilet bulunamadi']);
                exit;
            }

            // Permission: only the ticket owner may download the PDF.
            // Previously company managers could also download; change: only owner allowed.
            if (!isset($payload['user_id']) || $payload['user_id'] !== $row['user_id']) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Bu bileti indirme yetkiniz yok']);
                exit;
            }

            // Fetch seats
            $seatStmt = $db->prepare("SELECT seat_number FROM Booked_Seats WHERE ticket_id = ? ORDER BY seat_number");
            $seatStmt->execute([$ticketId]);
            $seats = $seatStmt->fetchAll(PDO::FETCH_COLUMN, 0);

            // Build lines for PDF
            // Determine status label for export (match frontend logic)
            $statusLabel = 'Aktif';
            if (isset($row['status']) && $row['status'] === 'canceled') {
                $statusLabel = 'İptal Edildi';
            } else {
                if (!empty($row['departure_time']) && strtotime($row['departure_time']) < time()) {
                    $statusLabel = 'Süresi Dolmuş';
                }
            }

            $seatCount = !empty($seats) ? count($seats) : 0;
            $seatPrice = isset($row['seat_price']) ? (int)$row['seat_price'] : 0;
            $originalTotal = $seatPrice * $seatCount;
            $finalTotal = (int)$row['total_price'];
            $saved = max(0, $originalTotal - $finalTotal);

            $lines = [];
            $lines[] = 'Bilet No: ' . $row['ticket_id'];
            $lines[] = 'Sahip: ' . ($row['owner_name'] ?? '') . ' <' . ($row['owner_email'] ?? '') . '>';
            $lines[] = 'Firma: ' . ($row['company_name'] ?? '');
            $lines[] = 'Kalkış: ' . ($row['departure_city'] ?? '') . ' - ' . ($row['departure_time'] ?? '');
            $lines[] = 'Varış: ' . ($row['destination_city'] ?? '') . ' - ' . ($row['arrival_time'] ?? '');
            $lines[] = 'Koltuklar: ' . (!empty($seats) ? implode(', ', $seats) : '-');
            if ($saved > 0) {
                $lines[] = 'Toplam Tutar (orjinal -> indirimli): ' . $originalTotal . ' TL -> ' . $finalTotal . ' TL (Kazanç: ' . $saved . ' TL)';
            } else {
                $lines[] = 'Toplam Tutar: ' . $finalTotal . ' TL';
            }
            $lines[] = 'Durum: ' . $statusLabel;
            $lines[] = 'Oluşturuldu: ' . ($row['created_at'] ?? '');

            // Try to use DOMPDF (if installed) for a richer PDF with logo and styling
            $trans = array(
                'ç' => 'c', 'Ç' => 'C', 'ğ' => 'g', 'Ğ' => 'G', 'ı' => 'i', 'İ' => 'I',
                'ö' => 'o', 'Ö' => 'O', 'ş' => 's', 'Ş' => 'S', 'ü' => 'u', 'Ü' => 'U'
            );
            $sanitize = function($s) use ($trans) {
                if ($s === null) return '';
                $s = (string)$s;
                $s = strtr($s, $trans);
                $s = preg_replace('/[^\x00-\x7F]/','', $s);
                return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            };

            // Try to use dompdf if available
            $autoload = __DIR__ . '/vendor/autoload.php';
            if (file_exists($autoload)) {
                require_once $autoload;
                if (class_exists('\Dompdf\Dompdf')) {
                    // Build HTML ticket
                    $owner = $sanitize($row['owner_name'] ?? '') . ' &lt;' . $sanitize($row['owner_email'] ?? '') . '&gt;';
                    $company = $sanitize($row['company_name'] ?? '');
                    $departure = $sanitize(($row['departure_city'] ?? '') . ' - ' . ($row['departure_time'] ?? ''));
                    $arrival = $sanitize(($row['destination_city'] ?? '') . ' - ' . ($row['arrival_time'] ?? ''));
                    $seatList = !empty($seats) ? implode(', ', array_map('intval', $seats)) : '-';
                    $total = (int)$row['total_price'];
                    // compute original and saved if available
                    $seatCount = !empty($seats) ? count($seats) : 0;
                    $seatPrice = isset($row['seat_price']) ? (int)$row['seat_price'] : 0;
                    $originalTotal = $seatPrice * $seatCount;
                    $saved = max(0, $originalTotal - $total);
                    // Map status to user-facing Turkish label (same as frontend)
                    if (isset($row['status']) && $row['status'] === 'canceled') {
                        $statusLabelDom = 'İptal Edildi';
                    } else {
                        if (!empty($row['departure_time']) && strtotime($row['departure_time']) < time()) {
                            $statusLabelDom = 'Süresi Dolmuş';
                        } else {
                            $statusLabelDom = 'Aktif';
                        }
                    }
                    $status = $sanitize($statusLabelDom);
                    $created = $sanitize($row['created_at'] ?? '');

                    // Logo removed from exported PDF: company logos remain in DB but
                    // we intentionally do not include them in generated PDFs to
                    // simplify rendering and avoid remote/file access issues.

                    $html = '<html><head><meta charset="utf-8"><style>
                      body { font-family: DejaVu Sans, Arial, Helvetica, sans-serif; font-size: 12px; }
                      .header { display:flex; align-items:center; gap:12px; margin-bottom:12px }
                      .logo { width:80px; height:80px; object-fit:contain }
                      .title { font-size:20px; font-weight:700 }
                      .line { border-top:1px solid #ddd; margin:8px 0; }
                      .row { display:flex; justify-content:space-between; padding:6px 0 }
                      .label { font-weight:700; width:120px }
                      .value { flex:1 }
                      .footer { margin-top:18px; font-size:11px; color:#666 }
                      </style></head><body>';

                    $html .= '<div class="header">';
                    $html .= '<div><div class="title">' . $company . ' - TICKET</div><div style="font-size:11px;color:#666">Ticket</div></div></div>';

                    $html .= '<div class="line"></div>';
                    $html .= '<div class="row"><div class="label">Bilet No</div><div class="value">' . $sanitize($row['ticket_id']) . '</div></div>';
                    $html .= '<div class="row"><div class="label">Sahip</div><div class="value">' . $owner . '</div></div>';
                    $html .= '<div class="row"><div class="label">Firma</div><div class="value">' . $company . '</div></div>';
                    $html .= '<div class="row"><div class="label">Kalkış</div><div class="value">' . $departure . '</div></div>';
                    $html .= '<div class="row"><div class="label">Varış</div><div class="value">' . $arrival . '</div></div>';
                    $html .= '<div class="row"><div class="label">Koltuklar</div><div class="value">' . $seatList . '</div></div>';
                    if ($saved > 0) {
                        $html .= '<div class="row"><div class="label">Toplam</div><div class="value"><span style="text-decoration:line-through;color:#888">' . $originalTotal . ' TL</span> <strong style="color:#1f8f3a;margin-left:8px">' . $total . ' TL</strong><div style="font-size:11px;color:#666">Kazanç: ' . $saved . ' TL</div></div></div>';
                    } else {
                        $html .= '<div class="row"><div class="label">Toplam</div><div class="value">' . $total . ' TL</div></div>';
                    }
                    $html .= '<div class="row"><div class="label">Durum</div><div class="value">' . $status . '</div></div>';
                    $html .= '<div class="line"></div>';
                    $html .= '<div class="footer">Oluşturuldu: ' . $created . '</div>';
                    $html .= '</body></html>';

                    $dompdf = new \Dompdf\Dompdf();
                    $options = $dompdf->getOptions();
                    $options->set('isRemoteEnabled', true);
                    $dompdf->setOptions($options);
                    $dompdf->loadHtml($html);
                    $dompdf->setPaper('A4', 'portrait');
                    $dompdf->render();
                    // Stream as attachment
                    $filename = 'ticket-' . preg_replace('/[^a-zA-Z0-9-_]/','', $row['ticket_id']) . '.pdf';
                    $dompdf->stream($filename, ['Attachment' => 1]);
                    exit;
                }
            }

            // Fallback minimal PDF (if dompdf not installed): transliterate and nicer ASCII-only layout
            $trans = array(
                'ç' => 'c', 'Ç' => 'C', 'ğ' => 'g', 'Ğ' => 'G', 'ı' => 'i', 'İ' => 'I',
                'ö' => 'o', 'Ö' => 'O', 'ş' => 's', 'Ş' => 'S', 'ü' => 'u', 'Ü' => 'U'
            );
            $sanitize = function($s) use ($trans) {
                if ($s === null) return '';
                $s = (string)$s;
                $s = strtr($s, $trans);
                // remove any remaining non-ascii
                $s = preg_replace('/[^\x00-\x7F]/','', $s);
                return $s;
            };

            // Prepare title and escaped tokens for PDF string literals
            $title = $sanitize('BILET - ' . ($row['company_name'] ?? ''));
            $esc = function($t) {
                return str_replace(array('\\', '(', ')'), array('\\\\', '\\(', '\\)'), $t);
            };
            $escTitle = $esc($title);

            // Compose a richer content stream using simple graphics + text (no external libs)
            $y = 740; // baseline for header region
            $contentLines = [];

            // Draw header colored bar (RGB between 0..1) and a thin separator line
            // Note: graphics operators must be outside text objects
            $contentLines[] = "0.15 0.55 0.9 rg";              // fill color (soft blue)
            $contentLines[] = "36 732 540 44 re";            // rectangle at top
            $contentLines[] = "f";                           // fill
            $contentLines[] = "0.8 0.8 0.8 RG";              // separator stroke color (light gray)
            $contentLines[] = "36 716 m 576 716 l S";       // horizontal separator line

            // Start text block
            $contentLines[] = "BT";
            // Title in white inside header
            $contentLines[] = "/F2 20 Tf";                   // bold font for title
            $contentLines[] = "1 1 1 rg";                   // white text color
            $contentLines[] = sprintf("1 0 0 1 46 %d Tm (%s) Tj", $y + 16, $escTitle);
            // Reset text color to black and set default font
            $contentLines[] = "0 0 0 rg";
            $contentLines[] = "/F1 11 Tf";

            // Rows: label (bold) at x=36, value at x=200
            // Move rows further down so they don't overlap header area
            $rowY = $y - 60;
            $seatCount = !empty($seats) ? count($seats) : 0;
            $seatPrice = isset($row['seat_price']) ? (int)$row['seat_price'] : 0;
            $originalTotal = $seatPrice * $seatCount;
            $finalTotal = (int)$row['total_price'];
            $saved = max(0, $originalTotal - $finalTotal);

            $topDisplay = $finalTotal . ' TL';
            if ($saved > 0) {
                $topDisplay = $originalTotal . ' TL -> ' . $finalTotal . ' TL (Kazanç: ' . $saved . ' TL)';
            }

            $labelMap = [
                'Bilet No' => $row['ticket_id'],
                'Sahip' => (($row['owner_name'] ?? '') . ' <' . ($row['owner_email'] ?? '') . '>'),
                'Firma' => ($row['company_name'] ?? ''),
                'Kalkis' => (($row['departure_city'] ?? '') . ' - ' . ($row['departure_time'] ?? '')),
                'Varis' => (($row['destination_city'] ?? '') . ' - ' . ($row['arrival_time'] ?? '')),
                'Koltuklar' => (!empty($seats) ? implode(', ', $seats) : '-'),
                'Toplam' => $topDisplay,
                'Durum' => (isset($row['status']) && $row['status'] === 'canceled') ? 'İptal Edildi' : (!empty($row['departure_time']) && strtotime($row['departure_time']) < time() ? 'Süresi Dolmuş' : 'Aktif'),
                'Olusturuldu' => ($row['created_at'] ?? '')
            ];

            // Simple wrapper: breaks text into multiple lines if it's long
            $wrap = function($text, $maxChars = 48) use ($esc) {
                $text = (string)$text;
                if ($text === '') return [''];
                // If text contains spaces, prefer word wrap; otherwise chunk
                if (strpos($text, ' ') !== false) {
                    $parts = preg_split('/\s+/', $text);
                    $lines = [];
                    $current = '';
                    foreach ($parts as $p) {
                        if ($current === '') {
                            $current = $p;
                        } elseif (strlen($current) + 1 + strlen($p) <= $maxChars) {
                            $current .= ' ' . $p;
                        } else {
                            $lines[] = $current;
                            $current = $p;
                        }
                    }
                    if ($current !== '') $lines[] = $current;
                    return $lines;
                }
                // chunk continuous string (like UUID) every $maxChars
                return str_split($text, $maxChars);
            };

            foreach ($labelMap as $label => $value) {
                $lab = $esc($sanitize($label . ':'));
                $rawVal = $sanitize($value);
                $linesVal = $wrap($rawVal, 48);

                // Label (bold)
                $contentLines[] = "/F2 11 Tf";
                $contentLines[] = sprintf("1 0 0 1 36 %d Tm (%s) Tj", $rowY, $lab);

                // Values (may wrap to multiple lines) starting at x=200
                $first = true;
                foreach ($linesVal as $lv) {
                    $valEsc = $esc($lv);
                    $contentLines[] = "/F1 11 Tf";
                    // on the first wrapped line keep same rowY, subsequent lines flow down
                    $contentLines[] = sprintf("1 0 0 1 200 %d Tm (%s) Tj", $rowY - ($first ? 0 : 14), $valEsc);
                    $first = false;
                    $rowY -= ($first ? 0 : 0); // no-op but kept for clarity
                }

                // Move cursor down for next label block (ensure spacing even if wrapped)
                $rowY -= 18;
            }

            // small footer note
            $rowY -= 6;
            $footer = $esc($sanitize('Bu belge resmi bir bilet yerine gecmez.'));
            $contentLines[] = "0.6 0.6 0.6 rg"; // dim footer
            $contentLines[] = "/F1 9 Tf";
            $contentLines[] = sprintf("1 0 0 1 36 %d Tm (%s) Tj", $rowY, $footer);

            $contentLines[] = "ET";

            $contentStream = implode("\n", $contentLines);

            // Build PDF objects (include Helvetica and Helvetica-Bold)
            $objects = [];
            $objects[] = "%PDF-1.4\n%âãÏÓ\n";
            $objects[] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
            $objects[] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
            $objects[] = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >>\nendobj\n";
            $objects[] = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
            $objects[] = "5 0 obj\n<< /Length " . strlen($contentStream) . " >>\nstream\n" . $contentStream . "\nendstream\nendobj\n";
            $objects[] = "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n";

            $pdf = '';
            $offsets = [];
            $pdf .= $objects[0];
            $pos = strlen($pdf);
            for ($i = 1; $i < count($objects); $i++) {
                $offsets[$i] = $pos;
                $pdf .= $objects[$i];
                $pos = strlen($pdf);
            }
            $xrefPos = strlen($pdf);
            $pdf .= "xref\n0 " . (count($objects)) . "\n";
            $pdf .= sprintf("%010d %05d f\n", 0, 65535);
            for ($i = 1; $i < count($objects); $i++) {
                $pdf .= sprintf("%010d %05d n\n", $offsets[$i], 0);
            }
            $pdf .= "trailer\n<< /Size " . (count($objects)) . " /Root 1 0 R>>\nstartxref\n" . $xrefPos . "\n%%EOF\n";

            header('Content-Type: application/pdf');
            header('Content-Disposition: attachment; filename="ticket-' . preg_replace('/[^a-zA-Z0-9-_]/','', $row['ticket_id']) . '.pdf"');
            echo $pdf;
            exit;
        }
    }
    if ($method === 'GET') {
        $payload = authenticateUser();
        $db = getDB();

        // Return tickets for the authenticated user
    $stmt = $db->prepare("SELECT tk.id as ticket_id, tk.trip_id, tk.total_price, tk.status, tk.created_at, t.departure_time, t.arrival_time, t.departure_city, t.destination_city, t.price as seat_price, bc.name as company_name, bc.logo_path as company_logo FROM Tickets tk LEFT JOIN Trips t ON t.id = tk.trip_id LEFT JOIN Bus_Company bc ON bc.id = t.company_id WHERE tk.user_id = ? ORDER BY tk.created_at DESC");
        $stmt->execute([$payload['user_id']]);
        $tickets = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // fetch seats for each ticket
        $seatStmt = $db->prepare("SELECT seat_number FROM Booked_Seats WHERE ticket_id = ? ORDER BY seat_number");
        foreach ($tickets as &$tk) {
            $seatStmt->execute([$tk['ticket_id']]);
            $seats = $seatStmt->fetchAll(PDO::FETCH_COLUMN, 0);
            $tk['seats'] = array_map('intval', $seats);
        }


// Support deleting (cancelling) a ticket: DELETE /api/tickets.php/{id}
        http_response_code(200);
        echo json_encode(['success' => true, 'data' => $tickets]);
        exit;
    }

// Support deleting (cancelling) a ticket: DELETE /api/tickets.php/{id}
if ($method === 'DELETE') {
    // Extract ticket id from URL
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $parts = explode('/', trim($path, '/'));
    $last = end($parts);
    $ticketId = null;
    if ($last !== 'tickets.php' && !empty($last) && strlen($last) > 3) {
        $ticketId = $last;
    }

    if (!$ticketId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Ticket id gerekli']);
        exit;
    }

    // Authenticated user required
    $payload = authenticateUser();

    $db = getDB();

    // Load ticket and related trip
    $tstmt = $db->prepare("SELECT tk.id as ticket_id, tk.user_id, tk.total_price, tk.status, tk.coupon_id, t.id as trip_id, t.departure_time, t.company_id FROM Tickets tk LEFT JOIN Trips t ON t.id = tk.trip_id WHERE tk.id = ? LIMIT 1");
    $tstmt->execute([$ticketId]);
    $ticket = $tstmt->fetch(PDO::FETCH_ASSOC);
    if (!$ticket) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Bilet bulunamadi']);
        exit;
    }

    if ($ticket['status'] !== 'active') {
        http_response_code(409);
        echo json_encode(['success' => false, 'error' => 'Bilet iptal edilemez (aktif değil)']);
        exit;
    }

    // Enforce 1 hour cutoff before departure
    $now = new DateTime('now');
    $departure = new DateTime($ticket['departure_time']);
    $interval = $departure->getTimestamp() - $now->getTimestamp();
    if ($interval <= 3600) { // less than or equal to 1 hour
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Sefer kalkis saatine 1 saat kala veya daha yakın bilet iptal edilemez']);
        exit;
    }

    // Allow cancellation if requester is ticket owner OR company manager of the trip
    $allowed = false;
    // ticket owner
    if ($payload['user_id'] === $ticket['user_id']) {
        $allowed = true;
    } else {
        // check company manager
        if (isset($payload['role']) && $payload['role'] === 'company') {
            // verify user's company_id matches trip.company_id
            $ust = $db->prepare("SELECT company_id FROM User WHERE id = ?");
            $ust->execute([$payload['user_id']]);
            $urow = $ust->fetch(PDO::FETCH_ASSOC);
            if ($urow && $urow['company_id'] === $ticket['company_id']) {
                $allowed = true;
            }
        }
    }

    if (!$allowed) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Bu bileti iptal etme yetkiniz yok']);
        exit;
    }

    try {
        $db->beginTransaction();

        // Refund user balance
        $price = (int)$ticket['total_price'];
        if ($price > 0) {
            $upd = $db->prepare("UPDATE User SET balance = COALESCE(balance,0) + ? WHERE id = ?");
            $upd->execute([$price, $ticket['user_id']]);
        }

        // If this ticket used a coupon, restore the coupon's usage and remove the user_coupon record
        if (!empty($ticket['coupon_id'])) {
            try {
                // Remove the record indicating this user used the coupon (so used_count decreases)
                $delUC = $db->prepare("DELETE FROM User_Coupons WHERE coupon_id = ? AND user_id = ?");
                $delUC->execute([$ticket['coupon_id'], $ticket['user_id']]);

                // Increase coupon usage_limit by 1 so it can be used again
                $inc = $db->prepare("UPDATE Coupons SET usage_limit = usage_limit + 1 WHERE id = ?");
                $inc->execute([$ticket['coupon_id']]);
            } catch (Exception $e) {
                // If coupon restore fails, roll back the transaction and return error
                if ($db->inTransaction()) $db->rollBack();
                http_response_code(500);
                echo json_encode(['success' => false, 'error' => 'Kupon geri y fcklenirken hata: ' . $e->getMessage()]);
                exit;
            }
        }

        // Remove booked seats
        $delSeats = $db->prepare("DELETE FROM Booked_Seats WHERE ticket_id = ?");
        $delSeats->execute([$ticketId]);

        // Mark ticket canceled
        $cancel = $db->prepare("UPDATE Tickets SET status = 'canceled' WHERE id = ?");
        $cancel->execute([$ticketId]);

        // Optionally keep the ticket row for audit; do not delete

        $db->commit();

        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Bilet iptal edildi ve ucret iade edildi']);
        exit;
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Iptal islemi sirasinda hata: ' . $e->getMessage()]);
        exit;
    }
}
    // Method not allowed
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Desteklenen metodlar: GET, DELETE']);
    exit;
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Sunucu hatasi: ' . $e->getMessage()]);
    exit;
}

?>
