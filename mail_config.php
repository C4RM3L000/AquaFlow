<?php
// AquaFlow email is configured to send REAL messages through Gmail SMTP.
// Add api/mail_local.php (copy from api/mail_local.example.php) on your own computer.
// DO NOT put real Gmail credentials in GitHub or share this file publicly.
$localPath = __DIR__ . '/mail_local.php';
$local = is_file($localPath) ? require $localPath : [];
if (!is_array($local)) $local = [];
$sender = trim((string) ($local['gmail_address'] ?? (getenv('AQUAFLOW_GMAIL_ADDRESS') ?: '')));
$appPassword = preg_replace('/\s+/', '', (string) ($local['gmail_app_password'] ?? (getenv('AQUAFLOW_GMAIL_APP_PASSWORD') ?: '')));
return [
    'mode' => 'smtp',
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 587, // STARTTLS
    'smtp_username' => $sender,
    'smtp_password' => $appPassword,
    'from_email' => $sender,
    'from_name' => 'AquaFlow Water Delivery',
    // This matches the folder path shown in your XAMPP screenshot.
    // Change it to your actual URL if you move the project or publish it online.
    'app_url' => trim((string)($local['app_url'] ?? (getenv('AQUAFLOW_APP_URL') ?: 'http://localhost/IPT_DBA_ENTREP/AquaFlow_PHP_MySQL/'))),
];
