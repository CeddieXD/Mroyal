-- =========================================
-- DATABASE
-- =========================================

CREATE DATABASE IF NOT EXISTS mangoroyalkiosk
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;

USE mangoroyalkiosk;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS order_item_audit_logs;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS pos_order_meta;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS ai_interactions;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS admin_settings;

SET FOREIGN_KEY_CHECKS = 1;


-- =========================================
-- TABLE: categories
-- =========================================

CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE
);

INSERT INTO categories (category_name) VALUES
('BEST_SELLERS'),
('PREMIUM'),
('BASIC'),
('SEASONAL');


-- =========================================
-- TABLE: sessions
-- =========================================

DROP TABLE IF EXISTS sessions;

CREATE TABLE sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(50) DEFAULT 'KIOSK_01',
    status ENUM('active','completed','abandoned') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- TABLE: products
-- =========================================

DROP TABLE IF EXISTS products;

CREATE TABLE products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    ingredients TEXT,
    bundle_quantity INT NOT NULL DEFAULT 1,
    image_url VARCHAR(255),
    is_available BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (category_id)
    REFERENCES categories(category_id)
);


INSERT INTO products
    (product_id, category_id, name, description, ingredients, bundle_quantity, image_url, is_available)
VALUES
(1,1,'Mango Royal','Signature mango milkshake','Fresh ripe mango, whole milk, condensed milk, crushed ice, tapioca pearls',1,'MangoRoyal.png',1),
(2,1,'Mango Graham','Mango with graham and cream','Fresh ripe mango, whole milk, condensed milk, all-purpose cream, crushed graham crackers, crushed ice',1,'MangoGraham.png',1),
(3,1,'Mango Oreo','Mango with Oreo bits','Fresh ripe mango, whole milk, condensed milk, Oreo cookie crumbs, crushed ice',1,'MangoOreo.png',1),
(4,1,'Mango Mixed','Premium mango mix','Fresh ripe mango, banana, strawberry, whole milk, condensed milk, crushed ice',1,'MangoMix.png',1),
(5,2,'Mango Cheesecake','Cheesecake mango blend','Fresh ripe mango, cream cheese, cheesecake crumbs, whole milk, condensed milk, crushed ice',1,'MangoCheesecake.png',1),
(6,2,'Mango Strawberry','Strawberry mango blend','Fresh ripe mango, strawberry puree, whole milk, condensed milk, crushed ice',1,'MangoStrawberry.png',1),
(7,2,'Mango Banana','Banana mango blend','Fresh ripe mango, banana, whole milk, condensed milk, crushed ice',1,'MangoBanana.png',1),
(8,2,'Mango Choco Chips','Chocolate chip mango','Fresh ripe mango, whole milk, condensed milk, chocolate chips, crushed ice',1,'MangoChocoChips.png',1),
(9,2,'Mango Doble','2 Tall cups for ₱95','Double portion of fresh ripe mango, whole milk, condensed milk, crushed ice',2,'MangoDoble.png',1),
(10,3,'Mango Plain','Pure mango drink','Fresh ripe mango, whole milk, crushed ice',1,'MangoPlain.png',1),
(11,3,'Fresh Juice','Fresh mango juice','Fresh ripe mango, filtered water, crushed ice; no added sugar',1,'FreshJuice.png',1),
(12,3,'Naked Mango','No sugar added mango','Fresh ripe mango, unsweetened milk, crushed ice; no added sugar',1,'NakedMango.png',1),
(13,4,'Mango Ube Felize','Mango + Ube fusion','Fresh ripe mango, ube puree, whole milk, condensed milk, crushed ice',1,'MangoUbeFelize.png',1),
(14,4,'Mango Ube Karol','Seasonal mango + ube','Fresh ripe mango, ube halaya, whole milk, condensed milk, crushed ice',1,'MangoUbeKarol.png',1);


-- =========================================
-- TABLE: product_variants
-- =========================================

DROP TABLE IF EXISTS product_variants;

CREATE TABLE product_variants (
    variant_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    size_name ENUM('Tall','Grande') NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (product_id)
    REFERENCES products(product_id)
);


INSERT INTO product_variants VALUES
(1,1,'Tall',90,1),(2,1,'Grande',105,1),
(3,2,'Tall',65,1),(4,2,'Grande',75,1),
(5,3,'Tall',65,1),(6,3,'Grande',75,1),
(7,4,'Tall',65,1),(8,4,'Grande',75,1),
(10,5,'Grande',90,1),
(12,6,'Grande',90,1),
(14,7,'Grande',90,1),
(16,8,'Grande',90,1),
(17,9,'Tall',95,1),
(19,10,'Tall',55,1),(20,10,'Grande',65,1),
(21,11,'Tall',55,1),(22,11,'Grande',65,1),
(23,12,'Tall',85,1),(24,12,'Grande',110,1),
(25,13,'Tall',160,1),(26,13,'Grande',185,1),
(27,14,'Tall',160,1),(28,14,'Grande',185,1);

-- =========================================
-- TABLE: menu_addons
-- =========================================

DROP TABLE IF EXISTS menu_addons;

CREATE TABLE menu_addons (
    addon_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    price DECIMAL(10,2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE
);

INSERT INTO menu_addons (name, price) VALUES
('Pearls / Tapioca', 10),
('Nata de Coco', 10),
('Graham Crumbs / Crushed Graham', 10),
('Oreo Crumbs', 10),
('Choco Chips / Choco Bits', 17),
('Cheesecake', 22),
('Frosted Cream Cheese', 27);


-- =========================================
-- TABLE: orders
-- =========================================

CREATE TABLE orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT,
    subtotal DECIMAL(10,2) NOT NULL,
    delivery_fee DECIMAL(10,2) DEFAULT 10.00,
    total_price DECIMAL(10,2) NOT NULL,
    order_type ENUM('Dine-in','Take-out') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(32) DEFAULT 'PENDING',

    FOREIGN KEY (session_id)
    REFERENCES sessions(session_id)
);


-- =========================================
-- TABLE: order_items
-- =========================================

DROP TABLE IF EXISTS ai_interactions;

CREATE TABLE order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    variant_id INT,
    quantity INT NOT NULL,
    price_at_purchase DECIMAL(10,2) NOT NULL,
    add_ons JSON NULL,

    FOREIGN KEY (order_id)
    REFERENCES orders(order_id),

    FOREIGN KEY (variant_id)
    REFERENCES product_variants(variant_id)
);


-- =========================================
-- SAMPLE DATA: Today and Tomorrow
-- =========================================

WITH RECURSIVE date_range AS (
    SELECT DATE('2026-10-20') AS day_date
    UNION ALL
    SELECT DATE_ADD(day_date, INTERVAL 1 DAY)
    FROM date_range
    WHERE day_date < CURRENT_DATE()
),
order_seed AS (
    SELECT 0 AS seq
    UNION ALL
    SELECT seq + 1 FROM order_seed WHERE seq < 299
)
INSERT INTO sessions (device_id, status, created_at)
SELECT
    CONCAT('KIOSK_', MOD(os.seq, 6) + 1) AS device_id,
    'completed' AS status,
    TIMESTAMPADD(HOUR, MOD(os.seq, 16) + 8, dr.day_date) AS created_at
FROM date_range dr
CROSS JOIN order_seed os;

INSERT INTO orders (session_id, subtotal, delivery_fee, total_price, order_type, created_at, status)
SELECT
    s.session_id,
    ROUND((120 + (MOD(s.session_id, 17) * 9.5) + (MOD(s.session_id, 5) * 11)) * (1 + ((DAYOFYEAR(s.created_at) % 5) * 0.18)), 2) AS subtotal,
    CASE WHEN MOD(s.session_id, 3) = 0 THEN 10.00 ELSE 0.00 END AS delivery_fee,
    ROUND((120 + (MOD(s.session_id, 17) * 9.5) + (MOD(s.session_id, 5) * 11)) * (1 + ((DAYOFYEAR(s.created_at) % 5) * 0.18)) + (CASE WHEN MOD(s.session_id, 3) = 0 THEN 10.00 ELSE 0.00 END) + ((DAYOFYEAR(s.created_at) % 4) * 8), 2) AS total_price,
    CASE WHEN MOD(s.session_id, 2) = 0 THEN 'Dine-in' ELSE 'Take-out' END AS order_type,
    s.created_at,
    CASE MOD(s.session_id, 6)
        WHEN 0 THEN 'READY'
        WHEN 1 THEN 'PREPARING'
        WHEN 2 THEN 'VERIFIED'
        WHEN 3 THEN 'PENDING'
        WHEN 4 THEN 'READY'
        ELSE 'PREPARING'
    END AS status
FROM sessions s
WHERE s.created_at >= DATE('2026-10-20')
  AND s.created_at < TIMESTAMPADD(DAY, 1, CURRENT_DATE());

INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase)
SELECT
    o.order_id,
    1 + MOD((o.order_id + item_idx.idx * 3), 28) AS variant_id,
    CASE WHEN item_idx.idx = 0 THEN 1 + MOD(o.order_id, 2) ELSE 1 END AS quantity,
    pv.price AS price_at_purchase
FROM orders o
JOIN (
    SELECT 0 AS idx
    UNION ALL SELECT 1
    UNION ALL SELECT 2
) AS item_idx
JOIN product_variants pv ON pv.variant_id = 1 + MOD((o.order_id + item_idx.idx * 3), 28)
WHERE o.created_at >= DATE('2026-10-20')
  AND o.created_at < TIMESTAMPADD(DAY, 1, CURRENT_DATE());


-- =========================================
-- TABLE: order_item_audit_logs
-- =========================================

CREATE TABLE order_item_audit_logs (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    order_item_id INT NULL,
    variant_id INT NULL,
    product_name VARCHAR(100) NOT NULL,
    size_name VARCHAR(20) NULL,
    action VARCHAR(32) NOT NULL,
    previous_quantity INT NULL,
    new_quantity INT NULL,
    previous_price DECIMAL(10,2) NULL,
    new_price DECIMAL(10,2) NULL,
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NULL,
    source VARCHAR(32) NOT NULL,
    actor VARCHAR(100) NULL,
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_item_audit_order_time (order_id, created_at),
    INDEX idx_order_item_audit_variant (order_id, variant_id),
    FOREIGN KEY (order_id) REFERENCES orders(order_id)
);


-- =========================================
-- TABLE: ai_interactions
-- =========================================

CREATE TABLE ai_interactions (
    interaction_id INT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(50) DEFAULT 'KIOSK_01',
    user_prompt TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    intent_types JSON NULL,
    selected_product_id INT NULL,
    selected_product_name VARCHAR(100) NULL,
    selected_size VARCHAR(20) NULL,
    profile_snapshot JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- TABLE: admin_settings
-- =========================================

DROP TABLE IF EXISTS admin_settings;

CREATE TABLE admin_settings (
    settings_id TINYINT PRIMARY KEY,
    settings_json JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
