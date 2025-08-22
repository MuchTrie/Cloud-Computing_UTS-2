require('dotenv').config();
const mysql = require('mysql2/promise');

async function createNewUser() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: 3306,
      user: 'admin', // Master user
      password: 'Bravo932q#', // Master password
      database: process.env.DB_NAME,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    console.log('Connected as master user');
    
    // Buat user baru
    const newUser = 'muchtrie';
    const newPassword = 'Bravo932q';
    
    await connection.execute(`CREATE USER '${newUser}'@'%' IDENTIFIED BY '${newPassword}'`);
    console.log(`✅ User '${newUser}' created`);
    
    // Give permissions
    await connection.execute(`GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* TO '${newUser}'@'%'`);
    await connection.execute('FLUSH PRIVILEGES');
    console.log(`✅ Permissions granted to '${newUser}'`);
    
    await connection.end();
    
    console.log('\n🎉 Success! Update your .env file with:');
    console.log(`DB_USER=${newUser}`);
    console.log(`DB_PASSWORD=${newPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createNewUser();
