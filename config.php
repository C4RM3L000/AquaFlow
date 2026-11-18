<?php
// XAMPP default: localhost / root / empty password. Update if your MySQL credentials differ.
// Environment overrides: AQUAFLOW_DB_HOST, AQUAFLOW_DB_NAME, AQUAFLOW_DB_USER, AQUAFLOW_DB_PASS.
return [
    'host' => getenv('AQUAFLOW_DB_HOST') ?: '127.0.0.1',
    'name' => getenv('AQUAFLOW_DB_NAME') ?: 'aquaflow',
    'user' => getenv('AQUAFLOW_DB_USER') ?: 'root',
    'pass' => getenv('AQUAFLOW_DB_PASS') !== false ? getenv('AQUAFLOW_DB_PASS') : '',
];
