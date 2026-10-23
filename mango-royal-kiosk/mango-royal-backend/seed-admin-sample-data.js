require('dotenv').config();
const mysql = require('mysql2/promise');

const PRODUCT_ROWS = [
  [1, 1, 'Mango Royal', 'Signature mango milkshake', 'MangoRoyal.png', 1],
  [2, 1, 'Mango Graham', 'Mango with graham and cream', 'MangoGraham.png', 1],
  [3, 1, 'Mango Oreo', 'Mango with Oreo bits', 'MangoOreo.png', 1],
  [4, 1, 'Mango Mixed', 'Premium mango mix', 'MangoMix.png', 1],
  [5, 2, 'Mango Cheesecake', 'Cheesecake mango blend', 'MangoCheesecake.png', 1],
  [6, 2, 'Mango Strawberry', 'Strawberry mango blend', 'MangoStrawberry.png', 1],
  [7, 2, 'Mango Banana', 'Banana mango blend', 'MangoBanana.png', 1],
  [8, 2, 'Mango Choco Chips', 'Chocolate chip mango', 'MangoChocoChips.png', 1],
  [9, 2, 'Mango Doble', 'Double mango portion', 'MangoDoble.png', 1],
  [10, 3, 'Mango Plain', 'Pure mango drink', 'MangoPlain.png', 1],
  [11, 3, 'Fresh Juice', 'Fresh mango juice', 'FreshJuice.png', 1],
  [12, 3, 'Naked Mango', 'No sugar added mango', 'NakedMango.png', 1],
  [13, 4, 'Mango Ube Felize', 'Mango + Ube fusion', 'MangoUbeFelize.png', 1],
  [14, 4, 'Mango Ube Karol', 'Seasonal mango + ube', 'MangoUbeKarol.png', 1],
];

const VARIANT_ROWS = [
  [1, 1, 'Tall', 90.00], [2, 1, 'Grande', 105.00],
  [3, 2, 'Tall', 65.00], [4, 2, 'Grande', 75.00],
  [5, 3, 'Tall', 65.00], [6, 3, 'Grande', 75.00],
  [7, 4, 'Tall', 65.00], [8, 4, 'Grande', 75.00],
  [10, 5, 'Grande', 90.00],
  [12, 6, 'Grande', 90.00],
  [14, 7, 'Grande', 90.00],
  [16, 8, 'Grande', 90.00],
  [17, 9, 'Tall', 95.00],
  [19, 10, 'Tall', 55.00], [20, 10, 'Grande', 65.00],
  [21, 11, 'Tall', 55.00], [22, 11, 'Grande', 65.00],
  [23, 12, 'Tall', 85.00], [24, 12, 'Grande', 110.00],
  [25, 13, 'Tall', 160.00], [26, 13, 'Grande', 185.00],
  [27, 14, 'Tall', 160.00], [28, 14, 'Grande', 185.00],
];

const run = async () => {
  const rootConnection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    multipleStatements: true,
  });

  await rootConnection.query('CREATE DATABASE IF NOT EXISTS mangoroyalkiosk CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
  await rootConnection.end();

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'mangoroyalkiosk',
    multipleStatements: true,
  });

  await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
  await connection.execute('CREATE TABLE IF NOT EXISTS categories (category_id INT AUTO_INCREMENT PRIMARY KEY, category_name VARCHAR(50) NOT NULL UNIQUE)');
  await connection.execute('CREATE TABLE IF NOT EXISTS sessions (session_id INT AUTO_INCREMENT PRIMARY KEY, device_id VARCHAR(50) DEFAULT "KIOSK_01", status ENUM("active","completed","abandoned") DEFAULT "active", created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  await connection.execute('CREATE TABLE IF NOT EXISTS products (product_id INT AUTO_INCREMENT PRIMARY KEY, category_id INT, name VARCHAR(100) NOT NULL, description TEXT, image_url VARCHAR(255), is_available BOOLEAN DEFAULT TRUE, FOREIGN KEY (category_id) REFERENCES categories(category_id))');
  await connection.execute('CREATE TABLE IF NOT EXISTS product_variants (variant_id INT AUTO_INCREMENT PRIMARY KEY, product_id INT, size_name ENUM("Tall","Grande") NOT NULL, price DECIMAL(10,2) NOT NULL, FOREIGN KEY (product_id) REFERENCES products(product_id))');
  await connection.execute('CREATE TABLE IF NOT EXISTS orders (order_id INT AUTO_INCREMENT PRIMARY KEY, session_id INT, subtotal DECIMAL(10,2) NOT NULL, delivery_fee DECIMAL(10,2) DEFAULT 10.00, total_price DECIMAL(10,2) NOT NULL, order_type ENUM("Dine-in","Take-out") NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status VARCHAR(32) DEFAULT "PENDING", FOREIGN KEY (session_id) REFERENCES sessions(session_id))');
  await connection.execute('CREATE TABLE IF NOT EXISTS order_items (order_item_id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, variant_id INT, quantity INT NOT NULL, price_at_purchase DECIMAL(10,2) NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(order_id), FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id))');
  await connection.execute('CREATE TABLE IF NOT EXISTS order_item_audit_logs (audit_id BIGINT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, order_item_id INT NULL, variant_id INT NULL, product_name VARCHAR(100) NOT NULL, size_name VARCHAR(20) NULL, action VARCHAR(32) NOT NULL, previous_quantity INT NULL, new_quantity INT NULL, previous_price DECIMAL(10,2) NULL, new_price DECIMAL(10,2) NULL, previous_status VARCHAR(32) NULL, new_status VARCHAR(32) NULL, source VARCHAR(32) NOT NULL, actor VARCHAR(100) NULL, details JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_order_item_audit_order_time (order_id, created_at), INDEX idx_order_item_audit_variant (order_id, variant_id), FOREIGN KEY (order_id) REFERENCES orders(order_id))');
  await connection.execute('CREATE TABLE IF NOT EXISTS ai_interactions (interaction_id INT AUTO_INCREMENT PRIMARY KEY, device_id VARCHAR(50) DEFAULT "KIOSK_01", user_prompt TEXT NOT NULL, ai_response TEXT NOT NULL, intent_types JSON NULL, selected_product_id INT NULL, selected_product_name VARCHAR(100) NULL, selected_size VARCHAR(20) NULL, profile_snapshot JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  await connection.execute('CREATE TABLE IF NOT EXISTS admin_settings (settings_id TINYINT PRIMARY KEY, settings_json JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)');
  await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

  await connection.execute("INSERT IGNORE INTO categories (category_id, category_name) VALUES (1, 'BEST_SELLERS'), (2, 'PREMIUM'), (3, 'BASIC'), (4, 'SEASONAL')");

  for (const product of PRODUCT_ROWS) {
    await connection.execute(
      'INSERT IGNORE INTO products (product_id, category_id, name, description, image_url, is_available) VALUES (?, ?, ?, ?, ?, ?)',
      product
    );
  }

  for (const variant of VARIANT_ROWS) {
    await connection.execute(
      'INSERT IGNORE INTO product_variants (variant_id, product_id, size_name, price) VALUES (?, ?, ?, ?)',
      variant
    );
  }

  await connection.execute('DELETE FROM order_item_audit_logs');
  await connection.execute('DELETE FROM order_items');
  await connection.execute('DELETE FROM orders');
  await connection.execute('DELETE FROM sessions');

  const startDate = new Date('2026-10-20T00:00:00');
  const today = new Date();
  const dayCount = Math.max(1, Math.ceil((today - startDate) / 86400000) + 1);

  let sessionCount = 0;
  let orderCount = 0;

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const day = new Date(startDate);
    day.setDate(startDate.getDate() + dayIndex);

    const dailyOrders = 220 + ((dayIndex * 17) % 60);

    for (let orderIndex = 0; orderIndex < dailyOrders; orderIndex++) {
      const createdAt = new Date(day);
      const hour = 8 + (orderIndex % 12);
      const minute = (orderIndex * 7) % 60;
      createdAt.setHours(hour, minute, 0, 0);

      const deviceId = `KIOSK_${(orderIndex % 6) + 1}`;
      const status = ['completed', 'completed', 'completed', 'completed', 'completed', 'abandoned'][orderIndex % 6];

      const [sessionInsert] = await connection.execute(
        'INSERT INTO sessions (device_id, status, created_at) VALUES (?, ?, ?)',
        [deviceId, status, createdAt]
      );

      const sessionId = sessionInsert.insertId;
      sessionCount += 1;

      const dayVariance = 1 + ((dayIndex % 5) * 0.18);
      const subtotal = (180 + ((orderIndex * 13) % 280) + (dayIndex % 6) * 15) * dayVariance;
      const deliveryFee = orderIndex % 3 === 0 ? 10 : 0;
      const totalPrice = subtotal + deliveryFee + (dayIndex % 4) * 8;
      const orderType = orderIndex % 2 === 0 ? 'Dine-in' : 'Take-out';
      const orderStatus = ['READY', 'PREPARING', 'VERIFIED', 'PENDING', 'READY'][orderIndex % 5];

      const [orderInsert] = await connection.execute(
        'INSERT INTO orders (session_id, subtotal, delivery_fee, total_price, order_type, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sessionId, Number(subtotal).toFixed(2), Number(deliveryFee).toFixed(2), Number(totalPrice).toFixed(2), orderType, createdAt, orderStatus]
      );

      const orderId = orderInsert.insertId;
      orderCount += 1;

      const itemCount = 1 + (orderIndex % 3);

      for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
        const variantId = 1 + ((orderId + itemIndex * 7) % 28);
        const quantity = 1 + ((orderId + itemIndex) % 2);
        const [variantRows] = await connection.execute('SELECT price FROM product_variants WHERE variant_id = ?', [variantId]);

        if (!variantRows.length) continue;

        const price = Number(variantRows[0].price);
        await connection.execute(
          'INSERT INTO order_items (order_id, variant_id, quantity, price_at_purchase) VALUES (?, ?, ?, ?)',
          [orderId, variantId, quantity, Number(price).toFixed(2)]
        );
      }
    }
  }

  console.log(`Sample data ready from 2026-10-20 through ${today.toISOString().slice(0, 10)}.`);
  console.log(`Inserted ${sessionCount} sessions and ${orderCount} orders.`);

  await connection.end();
  await rootConnection.end();
};

run().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
