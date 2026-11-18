<?php
declare(strict_types=1);
// Local terminal only: send a REAL test message through configured Gmail SMTP.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }
require dirname(__DIR__) . '/api/mail.php';
$config = mailSettings();
if (($config['mode'] ?? '') !== 'smtp') {
    fwrite(STDERR, "Email mode is not smtp. No test sent.\n");
    exit(1);
}
if (empty($config['smtp_username']) || empty($config['smtp_password'])) {
    fwrite(STDERR, "Gmail credentials are missing. Copy api/mail_local.example.php to api/mail_local.php and fill the sender Gmail and Google App Password.\n");
    exit(1);
}
$recipient = trim((string)($argv[1] ?? ''));
if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Usage: php tools/test_gmail.php recipient@gmail.com\n");
    exit(1);
}
try {
    sendAquaMail($recipient, 'AquaFlow Gmail SMTP test',
        "AquaFlow Gmail SMTP accepted this test email at " . date('c') . ".\n\nVerification OTP and password reset messages will be sent using this Gmail account.");
    echo "Gmail SMTP accepted the test for {$recipient}. Check Inbox and Spam.\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Gmail SMTP test failed: ' . $e->getMessage() . "\n");
    exit(1);
}
