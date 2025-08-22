require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    // Konfigurasi dari file .env
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    console.log('✅ Database connection successful!');
    await connection.execute('SELECT 1');
    await connection.end();
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
}

testConnection();