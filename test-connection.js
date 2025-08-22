require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    // Test with different configuration
    const connection = await mysql.createConnection({
      host: 'db-much.cfo8uqy0i602.ap-southeast-2.rds.amazonaws.com',
      port: 3306,
      user: 'admin',
      password: 'Bravo932q#', // Ganti dengan password yang benar
      database: 'much',
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