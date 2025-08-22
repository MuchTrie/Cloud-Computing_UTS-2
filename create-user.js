require('dotenv').config();
const mysql = require('mysql2/promise');

async function createNewUser() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
      user: process.env.DB_MASTER_USER,
      password: process.env.DB_MASTER_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    console.log('Connected as master user');
    
  // Buat user baru dari .env atau fallback default
  const newUser = process.env.DB_USER || 'muchtrie';
  const newPassword = process.env.DB_PASSWORD || 'Bravo932q';

  await connection.execute(`CREATE USER IF NOT EXISTS '${newUser}'@'%' IDENTIFIED BY '${newPassword}'`);
  console.log(`✅ User '${newUser}' created (or already exists)`);

  // Give permissions
  await connection.execute(`GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* TO '${newUser}'@'%'`);
  await connection.execute('FLUSH PRIVILEGES');
  console.log(`✅ Permissions granted to '${newUser}'`);

  await connection.end();

  console.log('\n🎉 Success! Pastikan .env kamu berisi:');
  console.log(`DB_USER=${newUser}`);
  console.log(`DB_PASSWORD=${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createNewUser();
