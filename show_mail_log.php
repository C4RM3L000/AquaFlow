<?php
declare(strict_types=1);
// Only use on the local server (OTP codes / reset links are private).
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/api/mail.php';
$path = mailLogPath();
echo "AquaFlow prototype mail log: {$path}\n";
if (!is_file($path)) { echo "No emails have been logged yet. Register a test customer first.\n"; exit; }
// Print the last 15 KB to make a recent verification email easy to find.
$data = file_get_contents($path);
echo substr($data ?: '', -15000), "\n";
