-- AquaFlow: PHP 8.1+ / MySQL 8+ or MariaDB 10.4+
-- Import using phpMyAdmin > Import. Sample product records only; no demo passwords.
CREATE DATABASE IF NOT EXISTS aquaflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aquaflow;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer', 'admin', 'rider') NOT NULL DEFAULT 'customer',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  default_address VARCHAR(255) NOT NULL DEFAULT '',
  availability ENUM('Available', 'Busy', 'Offline') NOT NULL DEFAULT 'Available',
  email_verified_at DATETIME NULL DEFAULT NULL,
  session_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  description VARCHAR(500) NOT NULL DEFAULT '',
  icon VARCHAR(50) NOT NULL DEFAULT 'droplet',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS addresses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(50) NOT NULL,
  address VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
  user_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  contact VARCHAR(30) NOT NULL,
  address VARCHAR(255) NOT NULL,
  delivery_date DATE NOT NULL,
  delivery_time VARCHAR(45) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Pending', 'Confirmed', 'Preparing', 'Assigned', 'Out for Delivery', 'Delivered', 'Cancelled') NOT NULL DEFAULT 'Pending',
  rider_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX (user_id, created_at),
  INDEX (rider_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(120) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  INDEX (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL DEFAULT 'AquaFlow Water Delivery',
  business_address VARCHAR(255) NOT NULL DEFAULT 'Metro Manila, Philippines',
  business_hours VARCHAR(100) NOT NULL DEFAULT '07:00 AM - 07:00 PM',
  delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 40.00,
  free_delivery_min DECIMAL(10,2) NOT NULL DEFAULT 200.00,
  notifications_enabled TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(191) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Verification codes are hashed, expire after 10 minutes and allow 5 attempts.
CREATE TABLE IF NOT EXISTS email_verifications (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  code_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sent_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One-time password reset links; stored only as SHA-256 digests.
CREATE TABLE IF NOT EXISTS password_resets (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  requested_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One current GPS reading per delivery. No rider movement history is retained.
CREATE TABLE IF NOT EXISTS order_tracking (
  order_id BIGINT UNSIGNED PRIMARY KEY,
  rider_id BIGINT UNSIGNED NOT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  accuracy_m DECIMAL(8,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 0,
  last_ping DATETIME NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (rider_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (rider_id, active)
) ENGINE=InnoDB;

INSERT IGNORE INTO settings (id) VALUES (1);
INSERT INTO products (id, name, price, stock, description, icon) VALUES
(1, 'Purified Water', 50.00, 150, 'Multi-stage filtered drinking water for everyday home and office use.', 'droplet'),
(2, 'Mineral Water', 60.00, 80, 'Clean drinking water with naturally occurring minerals.', 'water'),
(3, 'Alkaline Water', 80.00, 60, 'Alkaline drinking water for customers who prefer a higher-pH option.', 'droplet-half')
ON DUPLICATE KEY UPDATE id = id;
