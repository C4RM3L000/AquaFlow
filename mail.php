<?php
declare(strict_types=1);

/** SMTP STARTTLS + AUTH LOGIN transport (PHP OpenSSL required), or log-only local preview. */
function mailSettings(): array { return require __DIR__ . '/mail_config.php'; }
function mailLogPath(): string { return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'aquaflow_mail_' . substr(hash('sha256', __DIR__), 0, 12) . '.log'; }
function smtpRead($socket, array $codes): string
{
    $response = '';
    for ($i = 0; $i < 30; $i++) {
        $line = fgets($socket, 4096);
        if ($line === false) throw new RuntimeException('SMTP server disconnected.');
        $response .= $line;
        if (strlen($line) < 4 || $line[3] !== '-') break;
    }
    if (!in_array((int)substr($response, 0, 3), $codes, true)) {
        error_log('AquaFlow SMTP error: ' . substr(trim($response), 0, 300));
        throw new RuntimeException('SMTP service rejected the message. Check its configuration.');
    }
    return $response;
}
function smtpWriteAll($socket, string $content): void
{
    $length = strlen($content);
    $offset = 0;
    while ($offset < $length) {
        $n = fwrite($socket, substr($content, $offset));
        if ($n === false || $n === 0) throw new RuntimeException('SMTP write failed.');
        $offset += $n;
    }
}
function smtpCommand($socket, string $command, array $codes): string
{
    smtpWriteAll($socket, $command . "\r\n");
    return smtpRead($socket, $codes);
}
function sendAquaMail(string $recipient, string $subject, string $message): void
{
    $config = mailSettings();
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('Invalid recipient email.');
    $mode = (string)($config['mode'] ?? '');
    if ($mode === 'log') {
        // This path is OUTSIDE the web-served project directory on XAMPP.
        $file = mailLogPath();
        $log = sprintf("\n[%s] TO %s\nSUBJECT: %s\n%s\n", date('c'), $recipient, $subject, $message);
        if (file_put_contents($file, $log, FILE_APPEND | LOCK_EX) === false) throw new RuntimeException('Could not write prototype mail log.');
        return;
    }
    if ($mode !== 'smtp') throw new RuntimeException('Unknown email transport mode.');
    $host = (string)($config['smtp_host'] ?? '');
    $port = (int)($config['smtp_port'] ?? 587);
    $username = (string)($config['smtp_username'] ?? '');
    $password = (string)($config['smtp_password'] ?? '');
    $from = (string)($config['from_email'] ?? '');
    if (!$host || !$username || !$password || !filter_var($from, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('SMTP credentials are missing in api/mail_config.php.');
    }
    if (!extension_loaded('openssl')) throw new RuntimeException('PHP OpenSSL is required for SMTP STARTTLS.');
    $context = stream_context_create(['ssl' => ['verify_peer'=>true, 'verify_peer_name'=>true, 'peer_name'=>$host, 'SNI_enabled'=>true]]);
    $socket = @stream_socket_client('tcp://' . $host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $context);
    if (!$socket) throw new RuntimeException('Could not connect to SMTP host.');
    stream_set_timeout($socket, 15);
    try {
        smtpRead($socket, [220]);
        smtpCommand($socket, 'EHLO aquaflow.local', [250]);
        smtpCommand($socket, 'STARTTLS', [220]);
        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            throw new RuntimeException('SMTP TLS handshake failed.');
        }
        smtpCommand($socket, 'EHLO aquaflow.local', [250]);
        smtpCommand($socket, 'AUTH LOGIN', [334]);
        smtpCommand($socket, base64_encode($username), [334]);
        smtpCommand($socket, base64_encode($password), [235]);
        smtpCommand($socket, 'MAIL FROM:<' . $from . '>', [250]);
        smtpCommand($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
        smtpCommand($socket, 'DATA', [354]);
        $subjectHeader = '=?UTF-8?B?' . base64_encode($subject) . '?=';
        $fromName = '=?UTF-8?B?' . base64_encode((string)($config['from_name'] ?? 'AquaFlow')) . '?=';
        $headers = [
            'From: ' . $fromName . ' <' . $from . '>',
            'To: <' . $recipient . '>',
            'Subject: ' . $subjectHeader,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: base64',
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
        ];
        $mime = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($message), 76, "\r\n");
        // Prevent a dot on the first character of a line from terminating DATA.
        $mime = preg_replace('/(?<=\r\n)\./', '..', $mime);
        smtpWriteAll($socket, $mime . "\r\n.\r\n");
        smtpRead($socket, [250]);
        smtpCommand($socket, 'QUIT', [221]);
    } finally { fclose($socket); }
}
