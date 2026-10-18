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
  } catch (err) {
    console.error('MySQL Connection Warning / Error:', err.message);
    console.log('Continuing to backend startup...');
  }
}

verifyAndInitDB();
