<?php
declare(strict_types=1);
// CLI-only bootstrap for admin or rider accounts. Do not run this from the browser.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/api/db.php';
if ($argc !== 5 || !in_array($argv[1], ['admin', 'rider'], true) || !filter_var($argv[2], FILTER_VALIDATE_EMAIL) || strlen($argv[4]) < 8) {
    fwrite(STDERR, "Usage: php tools/create_user.php admin|rider email name password\nPassword must contain at least 8 characters.\n");
    exit(1);
}
try {
    $stmt = db()->prepare('INSERT INTO users (role, email, name, password_hash, email_verified_at) VALUES (?, ?, ?, ?, NOW())');
    $stmt->execute([$argv[1], strtolower($argv[2]), $argv[3], password_hash($argv[4], PASSWORD_DEFAULT)]);
    fwrite(STDOUT, ucfirst($argv[1]) . " account created.\n");
} catch (PDOException $e) {
    fwrite(STDERR, "Could not create user. Check database connection and unique email.\n");
    exit(1);
}
