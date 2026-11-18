<?php
declare(strict_types=1);

// AquaFlow JSON API: session authentication, role authorization, and prepared queries.
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

session_name('aquaflow_session');
ini_set('session.use_strict_mode', '1');
$secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
session_set_cookie_params(['httponly' => true, 'secure' => $secure, 'samesite' => 'Lax', 'path' => '/']);
session_start();
require __DIR__ . '/db.php';
require __DIR__ . '/mail.php';
date_default_timezone_set('Asia/Manila');

class ApiError extends RuntimeException
{
    public function __construct(string $message, public int $status = 400) { parent::__construct($message); }
}

function reply(array $payload = [], int $status = 200): never
{
    http_response_code($status);
    echo json_encode(['ok' => true] + $payload, JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    exit;
}
function fail(string $message, int $status = 400): never { throw new ApiError($message, $status); }
function input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true);
    if (!is_array($data)) fail('Invalid JSON request.');
    return $data;
}
function value(array $data, string $key, int $max = 255): string
{
    $v = trim((string)($data[$key] ?? ''));
    if (strlen($v) > $max) fail("$key is too long.");
    return $v;
}
function userId(): int { return (int)($_SESSION['user_id'] ?? 0); }
function user(): array
{
    if (!userId()) fail('Please sign in.', 401);
    $stmt = db()->prepare('SELECT id, name, email, role, phone, default_address, availability, email_verified_at, session_version FROM users WHERE id = ?');
    $stmt->execute([userId()]);
    $u = $stmt->fetch();
    if (!$u || (int)$u['session_version'] !== (int)($_SESSION['session_version'] ?? 0)) { unset($_SESSION['user_id'], $_SESSION['session_version']); fail('Your session expired. Please sign in again.', 401); }
    if (!$u['email_verified_at']) { unset($_SESSION['user_id'], $_SESSION['session_version']); fail('Please verify your email first.', 403); }
    return $u;
}
function requiredRole(string ...$roles): array
{
    $u = user();
    if (!in_array($u['role'], $roles, true)) fail('You do not have access to this action.', 403);
    return $u;
}
function validateEmail(string $email): void
{
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 191) fail('Enter a valid email address.');
}
function positiveId(mixed $v): int
{
    $id = filter_var($v, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) fail('Invalid ID.');
    return (int)$id;
}
function moneyValue(mixed $v): float
{
    if (!is_numeric($v) || (float)$v < 0 || (float)$v > 99999999) fail('Invalid amount.');
    return round((float)$v, 2);
}
function dateAndSlot(string $date, string $slot): void
{
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$d || $d->format('Y-m-d') !== $date) fail('Choose a valid delivery date.');
    $today = new DateTimeImmutable('today', new DateTimeZone('Asia/Manila'));
    if ($d < $today) fail('Delivery date cannot be in the past.');
    if (!in_array($slot, ['9:00 AM - 11:00 AM', '10:00 AM - 12:00 PM', '1:00 PM - 3:00 PM', '3:00 PM - 5:00 PM'], true)) fail('Choose a valid time slot.');
}
function row(string $sql, array $params = []): array|false
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetch();
}
function executeSql(string $sql, array $params = []): int
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}
function orderList(array $me): array
{
    $sql = "SELECT o.id, o.user_id, o.customer_name AS customer, o.contact,
                DATE(o.created_at) AS date, o.delivery_date, o.delivery_time,
                o.address, o.total, o.status, o.rider_id, o.subtotal, o.delivery_fee,
                COALESCE(r.name, '') AS rider,
                COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0) AS qty,
                COALESCE((SELECT GROUP_CONCAT(CONCAT(oi.quantity, 'x ', oi.product_name) ORDER BY oi.id SEPARATOR ', ') FROM order_items oi WHERE oi.order_id = o.id), '') AS products
            FROM orders o
            LEFT JOIN users r ON r.id = o.rider_id";
    $where = '';
    $args = [];
    if ($me['role'] === 'customer') { $where = ' WHERE o.user_id = ?'; $args[] = $me['id']; }
    if ($me['role'] === 'rider') { $where = ' WHERE o.rider_id = ?'; $args[] = $me['id']; }
    $stmt = db()->prepare($sql . $where . ' ORDER BY o.created_at DESC, o.id DESC');
    $stmt->execute($args);
    return array_map(static function (array $o): array {
        $o['id'] = '#' . $o['id'];
        $o['schedule'] = $o['delivery_date'] . ' • ' . $o['delivery_time'];
        return $o;
    }, $stmt->fetchAll());
}
function productList(bool $admin): array
{
    $stmt = db()->query('SELECT id, name, price, stock, description AS `desc`, icon, active FROM products ' . ($admin ? '' : 'WHERE active = 1 ') . 'ORDER BY id');
    return $stmt->fetchAll();
}
function saveOrder(int $customerId, string $name, string $phone, string $address, string $date, string $slot, array $items, bool $clearCart = false): int
{
    if (!$name || !$phone || !$address) fail('Complete your name, contact number, and delivery address.');
    if (strlen($name) > 120 || strlen($phone) > 30 || strlen($address) > 255) fail('Delivery information is too long.');
    dateAndSlot($date, $slot);
    if (!$items || count($items) > 30) fail('Your cart is empty or has too many items.');
    $unique = [];
    foreach ($items as $item) {
        if (!is_array($item)) fail('Invalid cart item.');
        $id = positiveId($item['id'] ?? 0);
        $qty = filter_var($item['qty'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000]]);
        if ($qty === false) fail('Invalid product quantity.');
        $unique[$id] = ($unique[$id] ?? 0) + (int)$qty;
        if ($unique[$id] > 1000) fail('Product quantity is too large.');
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $lines = [];
        $subtotalCents = 0;
        foreach ($unique as $id => $qty) {
            $p = row('SELECT id, name, price, stock FROM products WHERE id = ? AND active = 1 FOR UPDATE', [$id]);
            if (!$p) fail('A product in your cart is no longer available.');
            if ((int)$p['stock'] < $qty) fail($p['name'] . ' has insufficient stock.');
            $lineCents = (int)round((float)$p['price'] * 100) * $qty;
            $subtotalCents += $lineCents;
            $lines[] = [$p, $qty, $lineCents / 100];
        }
        $setting = row('SELECT delivery_fee, free_delivery_min FROM settings WHERE id = 1');
        if (!$setting) fail('Store settings are missing.');
        $feeCents = $subtotalCents >= (int)round((float)$setting['free_delivery_min'] * 100)
            ? 0 : (int)round((float)$setting['delivery_fee'] * 100);
        executeSql('INSERT INTO orders (user_id, customer_name, contact, address, delivery_date, delivery_time, subtotal, delivery_fee, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$customerId, $name, $phone, $address, $date, $slot, $subtotalCents / 100, $feeCents / 100, ($subtotalCents + $feeCents) / 100]);
        $orderId = (int)$pdo->lastInsertId();
        foreach ($lines as [$p, $qty, $lineTotal]) {
            executeSql('INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total) VALUES (?, ?, ?, ?, ?, ?)',
                [$orderId, $p['id'], $p['name'], $p['price'], $qty, $lineTotal]);
            executeSql('UPDATE products SET stock = stock - ? WHERE id = ?', [$qty, $p['id']]);
        }
        if ($clearCart) executeSql('DELETE FROM cart_items WHERE user_id = ?', [$customerId]);
        $pdo->commit();
        return $orderId;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/** Issue a verification code, storing only its password hash. Rate limited to 1/minute. */
function issueVerification(array $account, bool $enforceCooldown = true): bool
{
    $uid = (int)$account['id'];
    $old = row('SELECT sent_at FROM email_verifications WHERE user_id = ?', [$uid]);
    if ($enforceCooldown && $old && strtotime($old['sent_at']) > time() - 60) {
        fail('Please wait 60 seconds before requesting another code.', 429);
    }
    $code = (string)random_int(100000, 999999);
    executeSql('INSERT INTO email_verifications (user_id,code_hash,expires_at,attempts,sent_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0, NOW()) '
       . 'ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash), expires_at=VALUES(expires_at), attempts=0, sent_at=NOW()',
       [$uid,password_hash($code,PASSWORD_DEFAULT)]);
    try {
        sendAquaMail($account['email'], 'AquaFlow email verification code',
            "Hello {$account['name']},\n\nYour AquaFlow verification code is: {$code}\n\nThis code expires in 10 minutes. Do not share it.\n\nIf you did not register, you can ignore this message.");
        return true;
    } catch (Throwable $e) {
        error_log('AquaFlow mail delivery: ' . $e->getMessage());
        executeSql('DELETE FROM email_verifications WHERE user_id = ?', [$uid]);
        return false;
    }
}
function trackableOrder(int $orderId, array $me): array
{
    $order = row('SELECT id, user_id, rider_id, status FROM orders WHERE id = ?', [$orderId]);
    if (!$order) fail('Order not found.', 404);
    if ($me['role'] === 'customer' && (int)$order['user_id'] !== (int)$me['id']) fail('Not your order.', 403);
    if ($me['role'] === 'rider' && (int)$order['rider_id'] !== (int)$me['id']) fail('Not your assigned order.', 403);
    return $order;
}
function numberCoordinate(mixed $value, float $min, float $max, string $name): float
{
    if (!is_numeric($value)) fail('Invalid ' . $name);
    $number = (float)$value;
    if (!is_finite($number) || $number < $min || $number > $max) fail('Invalid ' . $name);
    return $number;
}
function trackingResult(int $orderId): array
{
    $t = row('SELECT latitude, longitude, accuracy_m, active, UNIX_TIMESTAMP(last_ping) AS updated_epoch '
        . 'FROM order_tracking WHERE order_id = ?', [$orderId]);
    if (!$t || !(bool)$t['active'] || $t['latitude'] === null || $t['longitude'] === null) {
        return ['active' => false, 'live' => false, 'latitude' => null, 'longitude' => null, 'updated_epoch' => null];
    }
    $age = time() - (int)$t['updated_epoch'];
    return ['active' => true, 'live' => $age >= 0 && $age <= 45,
        'latitude' => (float)$t['latitude'], 'longitude' => (float)$t['longitude'],
        'accuracy_m' => (float)$t['accuracy_m'], 'updated_epoch' => (int)$t['updated_epoch']];
}

try {
    $action = (string)($_GET['action'] ?? 'bootstrap');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    if ($method === 'POST') {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'], $token)) fail('Security token expired. Refresh the page.', 403);
        $body = input();
    } else {
        $body = [];
        if ($action !== 'bootstrap') fail('POST request required.', 405);
    }

    switch ($action) {
        case 'bootstrap':
            $me = null;
            if (userId()) {
                try { $me = user(); }
                catch (ApiError $e) { unset($_SESSION['user_id'], $_SESSION['session_version']); }
            }
            $result = [
                'csrf' => $_SESSION['csrf'],
                'user' => $me,
                'products' => productList($me && $me['role'] === 'admin'),
                'orders' => $me ? orderList($me) : [],
                'addresses' => [], 'riders' => [], 'customers' => [], 'cart' => [],
                'settings' => row('SELECT * FROM settings WHERE id = 1') ?: [],
                'mail_mode' => mailSettings()['mode'] ?? 'log',
            ];
            if ($me && $me['role'] === 'customer') {
                $stmt = db()->prepare('SELECT id, label, address, is_default FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id');
                $stmt->execute([$me['id']]);
                $result['addresses'] = $stmt->fetchAll();
                $cartStmt = db()->prepare('SELECT ci.product_id AS id, ci.quantity AS qty FROM cart_items ci JOIN products p ON p.id = ci.product_id AND p.active = 1 WHERE ci.user_id = ? ORDER BY ci.product_id');
                $cartStmt->execute([$me['id']]);
                $result['cart'] = $cartStmt->fetchAll();
            }
            if ($me && $me['role'] === 'admin') {
                $result['riders'] = db()->query("SELECT u.id, u.name, u.email, u.phone, u.availability, u.availability AS status,
                    (SELECT COUNT(*) FROM orders o WHERE o.rider_id = u.id AND o.status IN ('Assigned', 'Out for Delivery')) AS assigned
                    FROM users u WHERE u.role = 'rider' ORDER BY u.name")->fetchAll();
                $result['customers'] = db()->query("SELECT u.id, u.name, u.email, u.phone, u.default_address,
                    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
                    FROM users u WHERE u.role = 'customer' ORDER BY u.id DESC")->fetchAll();
            }
            reply($result);

        case 'register':
            $name = value($body, 'name', 120);
            $email = strtolower(value($body, 'email', 191));
            $password = (string)($body['password'] ?? '');
            $phone = value($body, 'phone', 30);
            $address = value($body, 'address', 255);
            if (!$name || !$phone || !$address) fail('Complete the registration form.');
            validateEmail($email);
            if (strlen($password) < 8 || strlen($password) > 200) fail('Password must contain 8 to 200 characters.');
            if (row('SELECT id FROM users WHERE email = ?', [$email])) fail('Email is already registered.', 409);
            $pdo = db();
            $pdo->beginTransaction();
            try {
                executeSql("INSERT INTO users (name, email, password_hash, role, phone, default_address) VALUES (?, ?, ?, 'customer', ?, ?)",
                    [$name, $email, password_hash($password, PASSWORD_DEFAULT), $phone, $address]);
                $newId = (int)$pdo->lastInsertId();
                executeSql('INSERT INTO addresses (user_id, label, address, is_default) VALUES (?, ?, ?, 1)', [$newId, 'Home', $address]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            $sent = issueVerification(['id' => $newId, 'name' => $name, 'email' => $email], false);
            reply(['message' => $sent ? 'Account created. Enter the code sent to your email.' : 'Account created, but the email could not be sent. Check SMTP and use Resend Code.', 'email_sent' => $sent], 201);

        case 'login':
            $email = strtolower(value($body, 'email', 191));
            $password = (string)($body['password'] ?? '');
            $found = row('SELECT id, password_hash, email_verified_at, session_version FROM users WHERE email = ?', [$email]);
            if (!$found || !password_verify($password, $found['password_hash'])) fail('Incorrect email or password.', 401);
            if (!$found['email_verified_at']) fail('Email not verified. Enter your verification code first.', 403);
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$found['id'];
            $_SESSION['session_version'] = (int)$found['session_version'];
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            reply(['message' => 'Signed in successfully.', 'csrf' => $_SESSION['csrf']]);

        case 'logout':
            unset($_SESSION['user_id'], $_SESSION['session_version']);
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            reply(['csrf' => $_SESSION['csrf']]);

        case 'verify_email':
            $email = strtolower(value($body, 'email', 191));
            $code = value($body, 'code', 6);
            validateEmail($email);
            if (!preg_match('/^\d{6}$/', $code)) fail('Enter a 6-digit code.');
            $pdo = db();
            $pdo->beginTransaction();
            try {
                $account = row('SELECT id, email_verified_at FROM users WHERE email = ? FOR UPDATE', [$email]);
                if (!$account) fail('Invalid or expired verification code.');
                if ($account['email_verified_at']) { $pdo->commit(); reply(['message'=>'Email is already verified. You can sign in.']); }
                $v = row('SELECT code_hash, expires_at, attempts FROM email_verifications WHERE user_id = ? FOR UPDATE', [$account['id']]);
                if (!$v || strtotime($v['expires_at']) < time() || (int)$v['attempts'] >= 5) fail('Code expired or too many attempts. Request a new code.');
                if (!password_verify($code, $v['code_hash'])) {
                    executeSql('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?', [$account['id']]);
                    $pdo->commit();
                    fail('Invalid verification code.');
                }
                executeSql('UPDATE users SET email_verified_at = NOW() WHERE id = ?', [$account['id']]);
                executeSql('DELETE FROM email_verifications WHERE user_id = ?', [$account['id']]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            reply(['message'=>'Email verified. You can now sign in.']);

        case 'resend_verification':
            $email = strtolower(value($body, 'email', 191));
            validateEmail($email);
            $account = row('SELECT id, name, email, email_verified_at FROM users WHERE email = ?', [$email]);
            if ($account && !$account['email_verified_at']) {
                if (!issueVerification($account)) fail('Email could not be sent. Check the mail settings and try again.', 503);
            }
            reply(['message'=>'If this email has an unverified account, a new code has been sent.']);

        case 'password_forgot':
            $email = strtolower(value($body, 'email', 191));
            validateEmail($email);
            $account = row('SELECT id, name FROM users WHERE email = ? AND email_verified_at IS NOT NULL', [$email]);
            if ($account) {
                $prev = row('SELECT requested_at FROM password_resets WHERE user_id = ?', [$account['id']]);
                if (!$prev || strtotime($prev['requested_at']) <= time() - 60) {
                    $token = bin2hex(random_bytes(32));
                    executeSql('INSERT INTO password_resets (user_id, token_hash, expires_at, requested_at) '
                        . 'VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE), NOW()) '
                        . 'ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash), expires_at=VALUES(expires_at), requested_at=NOW()',
                        [$account['id'], hash('sha256', $token)]);
                    $config = mailSettings();
                    $url = rtrim((string)($config['app_url'] ?? ''), '/') . '/#/reset-password?token=' . rawurlencode($token);
                    try {
                        sendAquaMail($email, 'AquaFlow password reset',
                            "Hello {$account['name']},\n\nReset your AquaFlow password using the link below (expires in 30 minutes):\n{$url}\n\nIf you did not request this, you can ignore this email.");
                    } catch (Throwable $e) {
                        error_log('AquaFlow mail delivery: ' . $e->getMessage());
                        executeSql('DELETE FROM password_resets WHERE user_id = ?', [$account['id']]);
                    }
                }
            }
            // Same response for registered/unregistered emails (avoids account enumeration).
            reply(['message'=>'If this email has a verified account, you will receive a reset link. Check your inbox or spam folder.']);

        case 'password_reset':
            $token = value($body, 'token', 128);
            $password = (string)($body['password'] ?? '');
            if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail('Invalid reset link.');
            if (strlen($password) < 8 || strlen($password) > 200) fail('Password must be 8–200 characters.');
            $pdo = db(); $pdo->beginTransaction();
            try {
                $reset = row('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ? FOR UPDATE', [hash('sha256', $token)]);
                if (!$reset || strtotime($reset['expires_at']) < time()) fail('Reset link is invalid or expired. Request a new one.');
                executeSql('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
                    [password_hash($password, PASSWORD_DEFAULT), $reset['user_id']]);
                executeSql('DELETE FROM password_resets WHERE user_id = ?', [$reset['user_id']]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            reply(['message'=>'Password updated. Sign in with your new password.']);

        case 'tracking_start':
            $me = requiredRole('rider');
            $id = positiveId($body['id'] ?? null);
            $order = trackableOrder($id, $me);
            if ($order['status'] !== 'Out for Delivery') fail('Mark the order Out for Delivery before sharing GPS.');
            executeSql('INSERT INTO order_tracking (order_id, rider_id, active) VALUES (?, ?, 1) '
                . 'ON DUPLICATE KEY UPDATE rider_id=VALUES(rider_id),active=1,latitude=NULL,longitude=NULL,accuracy_m=NULL,last_ping=NULL',
                [$id,$me['id']]);
            reply(['message'=>'GPS sharing started.']);

        case 'tracking_update':
            $me = requiredRole('rider');
            $id = positiveId($body['id'] ?? null);
            $order = trackableOrder($id, $me);
            if ($order['status'] !== 'Out for Delivery') fail('Delivery is not active.');
            $lat = numberCoordinate($body['latitude'] ?? null, -90, 90, 'latitude');
            $lon = numberCoordinate($body['longitude'] ?? null, -180, 180, 'longitude');
            $accuracy = numberCoordinate($body['accuracy_m'] ?? null, 0, 9999, 'GPS accuracy');
            $count = executeSql('UPDATE order_tracking SET latitude=?,longitude=?,accuracy_m=?,last_ping=NOW() '
                . 'WHERE order_id=? AND rider_id=? AND active=1', [$lat,$lon,$accuracy,$id,$me['id']]);
            if (!$count) fail('GPS sharing is not active. Tap Start Live GPS first.', 409);
            reply(['message'=>'Location updated.']);

        case 'tracking_stop':
            $me = requiredRole('rider');
            $id = positiveId($body['id'] ?? null);
            trackableOrder($id, $me);
            executeSql('DELETE FROM order_tracking WHERE order_id = ? AND rider_id = ?', [$id,$me['id']]);
            reply(['message'=>'Location sharing stopped.']);

        case 'tracking_get':
            $me = user();
            $id = positiveId($body['id'] ?? null);
            $order = trackableOrder($id, $me);
            reply(['tracking' => $order['status'] === 'Out for Delivery' ? trackingResult($id) : ['active'=>false,'live'=>false]]);

        case 'tracking_list':
            requiredRole('admin');
            $tracks = db()->query("SELECT o.id AS order_id, o.customer_name AS customer, r.name AS rider_name,
                t.latitude, t.longitude, t.accuracy_m, UNIX_TIMESTAMP(t.last_ping) AS updated_epoch
                FROM order_tracking t JOIN orders o ON o.id = t.order_id JOIN users r ON r.id = t.rider_id
                WHERE t.active = 1 AND t.latitude IS NOT NULL AND t.longitude IS NOT NULL AND o.status = 'Out for Delivery'")->fetchAll();
            reply(['locations' => array_map(static fn(array $t): array => [
                'order_id' => '#' . $t['order_id'], 'customer' => $t['customer'], 'rider_name' => $t['rider_name'],
                'latitude' => (float)$t['latitude'], 'longitude' => (float)$t['longitude'],
                'accuracy_m' => (float)$t['accuracy_m'], 'updated_epoch' => (int)$t['updated_epoch'],
                'live' => time() - (int)$t['updated_epoch'] <= 45,
            ], $tracks)]);

        case 'cart_set':
            $me = requiredRole('customer');
            $id = positiveId($body['id'] ?? null);
            $qty = filter_var($body['qty'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1000]]);
            if ($qty === false) fail('Invalid cart quantity.');
            if ($qty === 0) {
                executeSql('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [$me['id'], $id]);
            } else {
                $product = row('SELECT id, stock FROM products WHERE id = ? AND active = 1', [$id]);
                if (!$product) fail('Product no longer available.');
                if ((int)$product['stock'] < $qty) fail('Not enough stock available.');
                executeSql('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)', [$me['id'], $id, $qty]);
            }
            reply();

        case 'order_create':
            $me = requiredRole('customer');
            $id = saveOrder((int)$me['id'], value($body, 'name', 120), value($body, 'phone', 30),
                value($body, 'address', 255), value($body, 'date', 10), value($body, 'time', 45), $body['cart'] ?? [], true);
            reply(['id' => '#' . $id], 201);

        case 'order_admin_create':
            requiredRole('admin');
            $customerId = positiveId($body['customer_id'] ?? null);
            $customer = row("SELECT id, name, phone, default_address FROM users WHERE id = ? AND role = 'customer'", [$customerId]);
            if (!$customer) fail('Choose a registered customer.');
            $id = saveOrder($customerId, $customer['name'], $customer['phone'],
                $customer['default_address'], value($body, 'date', 10), value($body, 'time', 45), $body['cart'] ?? []);
            reply(['id' => '#' . $id], 201);

        case 'order_status':
            $me = requiredRole('admin', 'rider');
            $id = positiveId($body['id'] ?? null);
            $status = value($body, 'status', 40);
            $pdo = db();
            $pdo->beginTransaction();
            try {
                $o = row('SELECT * FROM orders WHERE id = ? FOR UPDATE', [$id]);
                if (!$o) fail('Order not found.', 404);
                if ($me['role'] === 'rider') {
                    if ((int)$o['rider_id'] !== (int)$me['id']) fail('Not your assigned delivery.', 403);
                    $allowed = ['Assigned' => ['Out for Delivery'], 'Out for Delivery' => ['Delivered']];
                } else {
                    $allowed = [
                        'Pending' => ['Confirmed', 'Cancelled'],
                        'Confirmed' => ['Preparing', 'Assigned', 'Cancelled'],
                        'Preparing' => ['Assigned', 'Cancelled'],
                        'Assigned' => ['Out for Delivery', 'Cancelled'],
                        'Out for Delivery' => ['Delivered', 'Cancelled'],
                    ];
                }
                if (!in_array($status, $allowed[$o['status']] ?? [], true)) fail('This status change is not allowed for the current order.');
                if ($status === 'Cancelled') {
                    $items = db()->prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?');
                    $items->execute([$id]);
                    foreach ($items->fetchAll() as $line) {
                        if ($line['product_id']) executeSql('UPDATE products SET stock = stock + ? WHERE id = ?', [$line['quantity'], $line['product_id']]);
                    }
                }
                executeSql('UPDATE orders SET status = ? WHERE id = ?', [$status, $id]);
                if (in_array($status, ['Delivered', 'Cancelled'], true)) executeSql('DELETE FROM order_tracking WHERE order_id = ?', [$id]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            reply(['message' => 'Order status updated.']);

        case 'order_assign':
            requiredRole('admin');
            $id = positiveId($body['id'] ?? null);
            $riderId = positiveId($body['rider_id'] ?? null);
            $rider = row("SELECT id FROM users WHERE id = ? AND role = 'rider' AND availability <> 'Offline'", [$riderId]);
            if (!$rider) fail('Choose an available rider.');
            $o = row('SELECT status FROM orders WHERE id = ?', [$id]);
            if (!$o || !in_array($o['status'], ['Confirmed', 'Preparing', 'Assigned'], true)) fail('Order must be confirmed/preparing before rider assignment.');
            executeSql('DELETE FROM order_tracking WHERE order_id = ?', [$id]);
            executeSql("UPDATE orders SET rider_id = ?, status = 'Assigned' WHERE id = ?", [$riderId, $id]);
            reply();

        case 'product_save':
            requiredRole('admin');
            $id = isset($body['id']) && $body['id'] !== null ? positiveId($body['id']) : null;
            $name = value($body, 'name', 120);
            $desc = value($body, 'desc', 500);
            if (!$name) fail('Enter a product name.');
            $price = moneyValue($body['price'] ?? null);
            if ($price <= 0) fail('Price must be greater than zero.');
            $stock = filter_var($body['stock'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1000000]]);
            if ($stock === false) fail('Stock must be a non-negative integer.');
            if ($id) {
                if (!executeSql('UPDATE products SET name = ?, price = ?, stock = ?, description = ?, active = 1 WHERE id = ?', [$name, $price, $stock, $desc, $id])) {
                    if (!row('SELECT id FROM products WHERE id = ?', [$id])) fail('Product not found.', 404);
                }
            } else {
                executeSql('INSERT INTO products (name, price, stock, description) VALUES (?, ?, ?, ?)', [$name, $price, $stock, $desc]);
            }
            reply();

        case 'product_delete':
            requiredRole('admin');
            $id = positiveId($body['id'] ?? null);
            if (!executeSql('UPDATE products SET active = 0 WHERE id = ? AND active = 1', [$id])) fail('Product not found.', 404);
            reply();

        case 'profile_save':
            $me = requiredRole('customer', 'rider', 'admin');
            $name = value($body, 'name', 120);
            $phone = value($body, 'phone', 30);
            $address = value($body, 'address', 255);
            if (!$name) fail('Full name is required.');
            $pdo = db();
            $pdo->beginTransaction();
            try {
                executeSql('UPDATE users SET name = ?, phone = ?, default_address = ? WHERE id = ?', [$name, $phone, $address, $me['id']]);
                if ($me['role'] === 'customer') executeSql('UPDATE addresses SET address = ? WHERE user_id = ? AND is_default = 1', [$address, $me['id']]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            reply();

        case 'password_change':
            $me = user();
            $current = (string)($body['current'] ?? '');
            $new = (string)($body['new_password'] ?? '');
            if (strlen($new) < 8 || strlen($new) > 200) fail('New password must contain 8 to 200 characters.');
            $auth = row('SELECT password_hash FROM users WHERE id = ?', [$me['id']]);
            if (!$auth || !password_verify($current, $auth['password_hash'])) fail('Current password is incorrect.');
            executeSql('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
            reply();

        case 'address_save':
            $me = requiredRole('customer');
            $id = isset($body['id']) && $body['id'] !== null ? positiveId($body['id']) : null;
            $label = value($body, 'label', 50);
            $address = value($body, 'address', 255);
            if (!$label || !$address) fail('Address label and complete address are required.');
            if ($id) {
                $existingAddr = row('SELECT is_default FROM addresses WHERE id = ? AND user_id = ?', [$id, $me['id']]);
                if (!$existingAddr) fail('Address not found.', 404);
                executeSql('UPDATE addresses SET label = ?, address = ? WHERE id = ? AND user_id = ?', [$label, $address, $id, $me['id']]);
                if ($existingAddr['is_default']) executeSql('UPDATE users SET default_address = ? WHERE id = ?', [$address, $me['id']]);
            } else {
                $existing = row('SELECT id FROM addresses WHERE user_id = ? LIMIT 1', [$me['id']]);
                executeSql('INSERT INTO addresses (user_id, label, address, is_default) VALUES (?, ?, ?, ?)', [$me['id'], $label, $address, $existing ? 0 : 1]);
                if (!$existing) executeSql('UPDATE users SET default_address = ? WHERE id = ?', [$address, $me['id']]);
            }
            reply();

        case 'address_default':
            $me = requiredRole('customer');
            $id = positiveId($body['id'] ?? null);
            $address = row('SELECT address FROM addresses WHERE id = ? AND user_id = ?', [$id, $me['id']]);
            if (!$address) fail('Address not found.', 404);
            $pdo = db();
            $pdo->beginTransaction();
            try {
                executeSql('UPDATE addresses SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?', [$id, $me['id']]);
                executeSql('UPDATE users SET default_address = ? WHERE id = ?', [$address['address'], $me['id']]);
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
            reply();

        case 'address_delete':
            $me = requiredRole('customer');
            $id = positiveId($body['id'] ?? null);
            $a = row('SELECT is_default FROM addresses WHERE id = ? AND user_id = ?', [$id, $me['id']]);
            if (!$a) fail('Address not found.', 404);
            if ($a['is_default']) fail('Set another default address before deleting this one.');
            executeSql('DELETE FROM addresses WHERE id = ? AND user_id = ?', [$id, $me['id']]);
            reply();

        case 'rider_create':
            requiredRole('admin');
            $name = value($body, 'name', 120);
            $phone = value($body, 'phone', 30);
            $email = strtolower(value($body, 'email', 191));
            $password = (string)($body['password'] ?? '');
            validateEmail($email);
            if (!$name || strlen($password) < 8 || strlen($password) > 200) fail('Rider name and password (8–200 characters) required.');
            if (row('SELECT id FROM users WHERE email = ?', [$email])) fail('Email is already registered.', 409);
            executeSql("INSERT INTO users (name, email, phone, password_hash, role, email_verified_at) VALUES (?, ?, ?, ?, 'rider', NOW())", [$name, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);
            reply();

        case 'rider_availability':
            $me = requiredRole('rider');
            $state = value($body, 'availability', 12);
            if (!in_array($state, ['Available', 'Busy', 'Offline'], true)) fail('Invalid availability.');
            executeSql('UPDATE users SET availability = ? WHERE id = ?', [$state, $me['id']]);
            reply();

        case 'settings_save':
            requiredRole('admin');
            $name = value($body, 'business_name', 120);
            $address = value($body, 'business_address', 255);
            $hours = value($body, 'business_hours', 100);
            $fee = moneyValue($body['delivery_fee'] ?? null);
            $threshold = moneyValue($body['free_delivery_min'] ?? null);
            if (!$name || !$address || !$hours) fail('Complete store information.');
            executeSql('UPDATE settings SET business_name = ?, business_address = ?, business_hours = ?, delivery_fee = ?, free_delivery_min = ?, notifications_enabled = ? WHERE id = 1',
                [$name, $address, $hours, $fee, $threshold, !empty($body['notifications_enabled']) ? 1 : 0]);
            reply();

        case 'contact_send':
            $name = value($body, 'name', 120);
            $email = value($body, 'email', 191);
            $message = value($body, 'message', 3000);
            if (!$name || !$message) fail('Name and message are required.');
            validateEmail($email);
            executeSql('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)', [$name, $email, $message]);
            reply(['message' => 'Message received.']);

        default:
            fail('Unknown action.', 404);
    }
} catch (ApiError $e) {
    http_response_code($e->status);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
} catch (PDOException $e) {
    error_log('AquaFlow DB: ' . $e->getMessage());
    http_response_code(500);
    $message = str_contains($e->getMessage(), 'could not find driver')
        ? 'PHP PDO MySQL extension is not enabled.'
        : (str_contains($e->getMessage(), 'SQLSTATE[HY000] [1049') ? 'AquaFlow database not found. Import database/aquaflow.sql.'
        : 'Database operation failed. Check MySQL and the database configuration.');
    echo json_encode(['ok' => false, 'error' => $message]);
} catch (Throwable $e) {
    error_log('AquaFlow API: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'An unexpected server error occurred.']);
}
