const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', 'mango-royal-kiosk', 'mango-royal-backend', '.env') });

async function verifyAndInitDB() {
  const host = process.env.DB_HOST || '127.0.0.1';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASS || '12345';
  const database = process.env.DB_NAME || 'mangoroyalkiosk';

  console.log(`Checking MySQL connection (${host}, user: ${user})...`);

  try {
    // 1. Connect without database first
    const connection = await mysql.createConnection({
      host,
      user,
      password,
      multipleStatements: true
    });

    console.log('Connected to MySQL successfully.');

    // 2. Check if database exists
    const [rows] = await connection.query(`SHOW DATABASES LIKE '${database}'`);
    if (rows.length === 0) {
      console.log(`Database '${database}' does not exist. Creating and initializing...`);
      const sqlFile = path.join(__dirname, '..', 'mango-royal-kiosk', 'mango-royal-backend', 'database_reset.sql');
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await connection.query(sql);
      console.log(`Database '${database}' created and initialized successfully!`);
    } else {
      console.log(`Database '${database}' already exists and is ready.`);
    }

    await connection.end();

    const databaseConnection = await mysql.createConnection({
      host,
      user,
      password,
      database
    });

    const [ingredientColumns] = await databaseConnection.query(
      `SELECT COUNT(*) AS column_count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'products'
         AND COLUMN_NAME = 'ingredients'`,
      [database]
    );

    if (ingredientColumns[0].column_count === 0) {
      await databaseConnection.query(
        'ALTER TABLE products ADD COLUMN ingredients TEXT NULL AFTER description'
      );
      console.log('Added missing products.ingredients column.');
    }

    const [bundleColumns] = await databaseConnection.query(
      `SELECT COUNT(*) AS column_count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'products'
         AND COLUMN_NAME = 'bundle_quantity'`,
      [database]
    );

    if (bundleColumns[0].column_count === 0) {
      await databaseConnection.query(
        'ALTER TABLE products ADD COLUMN bundle_quantity INT NOT NULL DEFAULT 1 AFTER ingredients'
      );
      console.log('Added products.bundle_quantity column.');
    }

    const [variantAvailabilityColumns] = await databaseConnection.query(
      `SELECT COUNT(*) AS column_count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'product_variants'
         AND COLUMN_NAME = 'is_available'`,
      [database]
    );

    if (variantAvailabilityColumns[0].column_count === 0) {
      await databaseConnection.query(
        'ALTER TABLE product_variants ADD COLUMN is_available BOOLEAN DEFAULT TRUE'
      );
      console.log('Added product_variants.is_available column.');
    }

    await databaseConnection.query(
      `UPDATE product_variants pv
       JOIN products p ON p.product_id = pv.product_id
       SET pv.is_available = (pv.size_name = 'Grande')
       WHERE p.name IN ('Mango Choco Chips', 'Mango Strawberry', 'Mango Cheesecake', 'Mango Banana')`
    );

    await databaseConnection.query(
      `UPDATE products
       SET bundle_quantity = 2, description = '2 Tall cups for ₱95'
       WHERE name = 'Mango Doble'`
    );

    const productIngredients = [
      ['Mango Royal', 'Fresh ripe mango, whole milk, condensed milk, crushed ice, tapioca pearls'],
      ['Mango Graham', 'Fresh ripe mango, whole milk, condensed milk, all-purpose cream, crushed graham crackers, crushed ice'],
      ['Mango Oreo', 'Fresh ripe mango, whole milk, condensed milk, Oreo cookie crumbs, crushed ice'],
      ['Mango Mixed', 'Fresh ripe mango, banana, strawberry, whole milk, condensed milk, crushed ice'],
      ['Mango Cheesecake', 'Fresh ripe mango, cream cheese, cheesecake crumbs, whole milk, condensed milk, crushed ice'],
      ['Mango Strawberry', 'Fresh ripe mango, strawberry puree, whole milk, condensed milk, crushed ice'],
      ['Mango Banana', 'Fresh ripe mango, banana, whole milk, condensed milk, crushed ice'],
      ['Mango Choco Chips', 'Fresh ripe mango, whole milk, condensed milk, chocolate chips, crushed ice'],
      ['Mango Doble', 'Double portion of fresh ripe mango, whole milk, condensed milk, crushed ice, tapioca pearls'],
      ['Mango Plain', 'Fresh ripe mango, whole milk, crushed ice'],
      ['Fresh Juice', 'Fresh ripe mango, filtered water, crushed ice; no added sugar'],
      ['Naked Mango', 'Fresh ripe mango, unsweetened milk, crushed ice; no added sugar'],
      ['Mango Ube Felize', 'Fresh ripe mango, ube puree, whole milk, condensed milk, crushed ice'],
      ['Mango Ube Karol', 'Fresh ripe mango, ube halaya, whole milk, condensed milk, crushed ice']
    ];

    for (const [name, ingredients] of productIngredients) {
      await databaseConnection.query(
        `UPDATE products
         SET ingredients = ?
         WHERE name = ?
           AND (ingredients IS NULL OR TRIM(ingredients) = '')`,
        [ingredients, name]
      );
    }

    const menuPrices = [
      ['Mango Royal', 'Tall', 90],
      ['Mango Royal', 'Grande', 105],
      ['Mango Mix', 'Tall', 65],
      ['Mango Mix', 'Grande', 75],
      ['Mango Mixed', 'Tall', 65],
      ['Mango Mixed', 'Grande', 75],
      ['Mango Graham', 'Tall', 65],
      ['Mango Graham', 'Grande', 75],
      ['Mango Oreo', 'Tall', 65],
      ['Mango Oreo', 'Grande', 75],
      ['Mango Choco Chips', 'Grande', 90],
      ['Mango Strawberry', 'Grande', 90],
      ['Mango Cheesecake', 'Grande', 90],
      ['Mango Banana', 'Grande', 90],
      ['Mango Doble', 'Tall', 95],
      ['Mango Plain', 'Tall', 55],
      ['Mango Plain', 'Grande', 65],
      ['Fresh Juice', 'Tall', 55],
      ['Fresh Juice', 'Grande', 65]
    ];

    for (const [name, size, price] of menuPrices) {
      await databaseConnection.query(
        `UPDATE product_variants pv
         JOIN products p ON p.product_id = pv.product_id
         SET pv.price = ?
         WHERE p.name = ? AND pv.size_name = ? AND pv.is_available = TRUE`,
        [price, name, size]
      );
    }

    await databaseConnection.query(`
      CREATE TABLE IF NOT EXISTS menu_addons (
        addon_id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        price DECIMAL(10,2) NOT NULL,
        is_available BOOLEAN DEFAULT TRUE
      )
    `);

    const menuAddons = [
      ['Pearls / Tapioca', 10],
      ['Nata de Coco', 10],
      ['Graham Crumbs / Crushed Graham', 10],
      ['Oreo Crumbs', 10],
      ['Choco Chips / Choco Bits', 17],
      ['Cheesecake', 22],
      ['Frosted Cream Cheese', 27]
    ];

    for (const [name, price] of menuAddons) {
      await databaseConnection.query(
        `INSERT INTO menu_addons (name, price)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE price = VALUES(price), is_available = TRUE`,
        [name, price]
      );
    }

    await databaseConnection.end();
    console.log('Product ingredients, menu prices, and add-on prices are ready.');
  } catch (err) {
    console.error('MySQL Connection Warning / Error:', err.message);
    console.log(`MySQL is not running, not installed, or the connection details in .env are incorrect.`);
    console.log(`Expected database: ${database} at ${host}:${process.env.DB_PORT || 3306}`);
    console.log('Start MySQL locally and initialize the schema before using the app features that depend on the database.');
    console.log('Continuing to backend startup...');
  }
}

verifyAndInitDB();
