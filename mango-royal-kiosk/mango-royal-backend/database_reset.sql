-- =========================================
-- DATABASE
-- =========================================

CREATE DATABASE IF NOT EXISTS mangoroyalkiosk
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;

USE mangoroyalkiosk;


-- =========================================
-- TABLE: categories
-- =========================================

DROP TABLE IF EXISTS categories;

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
    image_url VARCHAR(255),
    is_available BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (category_id)
    REFERENCES categories(category_id)
);


INSERT INTO products VALUES
(1,1,'Mango Royal','Signature mango milkshake','MangoRoyal.png',1),
(2,1,'Mango Graham','Mango with graham and cream','MangoGraham.png',1),
(3,1,'Mango Oreo','Mango with Oreo bits','MangoOreo.png',1),
(4,1,'Mango Mixed','Premium mango mix','MangoMix.png',1),
(5,2,'Mango Cheesecake','Cheesecake mango blend','MangoCheesecake.png',1),
(6,2,'Mango Strawberry','Strawberry mango blend','MangoStrawberry.png',1),
(7,2,'Mango Banana','Banana mango blend','MangoBanana.png',1),
(8,2,'Mango Choco Chips','Chocolate chip mango','MangoChocoChips.png',1),
(9,2,'Mango Doble','Double mango portion','MangoDoble.png',1),
(10,3,'Mango Plain','Pure mango drink','MangoPlain.png',1),
(11,3,'Fresh Juice','Fresh mango juice','FreshJuice.png',1),
(12,3,'Naked Mango','No sugar added mango','NakedMango.png',1),
(13,4,'Mango Ube Felize','Mango + Ube fusion','MangoUbeFelize.png',1),
(14,4,'Mango Ube Karol','Seasonal mango + ube','MangoUbeKarol.png',1);


-- =========================================
-- TABLE: product_variants
-- =========================================

DROP TABLE IF EXISTS product_variants;

CREATE TABLE product_variants (
    variant_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT,
    size_name ENUM('Tall','Grande') NOT NULL,
    price DECIMAL(10,2) NOT NULL,

    FOREIGN KEY (product_id)
    REFERENCES products(product_id)
);


INSERT INTO product_variants VALUES
(1,1,'Tall',120),(2,1,'Grande',145),
(3,2,'Tall',125),(4,2,'Grande',150),
(5,3,'Tall',130),(6,3,'Grande',155),
(7,4,'Tall',135),(8,4,'Grande',160),
(9,5,'Tall',150),(10,5,'Grande',175),
(11,6,'Tall',155),(12,6,'Grande',180),
(13,7,'Tall',145),(14,7,'Grande',170),
(15,8,'Tall',140),(16,8,'Grande',165),
(17,9,'Tall',170),(18,9,'Grande',195),
(19,10,'Tall',90),(20,10,'Grande',115),
(21,11,'Tall',80),(22,11,'Grande',105),
(23,12,'Tall',85),(24,12,'Grande',110),
(25,13,'Tall',160),(26,13,'Grande',185),
(27,14,'Tall',160),(28,14,'Grande',185);


-- =========================================
-- TABLE: orders
-- =========================================

DROP TABLE IF EXISTS order_item_audit_logs;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS pos_order_meta;
DROP TABLE IF EXISTS orders;

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

    FOREIGN KEY (order_id)
    REFERENCES orders(order_id),

    FOREIGN KEY (variant_id)
    REFERENCES product_variants(variant_id)
);


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
