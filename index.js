require('dotenv').config();
const express = require('express');
const AWS = require('aws-sdk');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const port = 3000;

// Konfigurasi AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,    
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, 
  region: process.env.AWS_REGION  
});

// Database Configuration
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  },
  connectTimeout: 60000
};

const s3 = new AWS.S3();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('views'));

// Route untuk halaman utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Route untuk halaman files (halaman baru)
app.get('/files', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'list-files.html'));
});

// API endpoint untuk mendapatkan list files dari Database (fallback ke S3)
app.get('/api/files', async (req, res) => {
  try {
    console.log('Trying to fetch files from database...');
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      'SELECT * FROM uploads ORDER BY upload_date DESC'
    );
    await connection.end();

    console.log(`Found ${rows.length} files in database`);

    const files = rows.map(row => ({
      id: row.id,
      name: row.s3_filename,
      originalName: row.original_filename,
      nama: row.nama,
      nrp: row.nrp,
      size: formatFileSize(row.file_size),
      uploadDate: formatDate(row.upload_date),
      url: row.s3_url
    }));

    res.json(files);
  } catch (dbError) {
    console.error('Database Error, falling back to S3:', dbError.message);
    
    // Fallback: ambil dari S3 langsung
    try {
      const params = {
        Bucket: process.env.S3_BUCKET_NAME
      };
      
      const data = await s3.listObjectsV2(params).promise();
      const files = data.Contents.map(file => ({
        name: file.Key,
        originalName: file.Key, // Sama dengan S3 filename
        nama: 'Unknown', // Tidak ada data nama dari S3
        nrp: 'Unknown', // Tidak ada data NRP dari S3
        size: formatFileSize(file.Size),
        uploadDate: formatDate(file.LastModified),
        url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`
      }));
      
      console.log(`Fallback: Found ${files.length} files in S3`);
      res.json(files);
    } catch (s3Error) {
      console.error('S3 Error:', s3Error);
      res.status(500).json({ error: 'Error retrieving files from both database and S3' });
    }
  }
});

// Helper function untuk format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function untuk format date
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric'
    }) + ' ' + d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded"
    });
  }

  const { nama, nrp } = req.body;
  
  if (!nama || !nrp) {
    return res.status(400).json({
      success: false,
      message: "Nama dan NRP harus diisi"
    });
  }

  const fileContent = fs.readFileSync(req.file.path);
  
  // Format nama file: [Nama]_[NRP]_[OriginalFileName]
  const sanitizedNama = nama.replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${sanitizedNama}_${nrp}_${req.file.originalname}`;
  
  const params = {
    Bucket: process.env.S3_BUCKET_NAME, 
    Key: fileName,
    Body: fileContent
  };

  try {
    console.log(`Uploading file: ${fileName} for ${nama} (${nrp})`);
    
    // Upload ke S3
    const s3Result = await s3.upload(params).promise();
    console.log('S3 upload successful:', s3Result.Location);
    
    // Save ke database (dengan error handling)
    try {
      console.log('Attempting to save to database...');
      console.log('Database config:', {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database
      });
      
      const connection = await mysql.createConnection(dbConfig);
      console.log('Database connection established');
      
      const insertQuery = `INSERT INTO uploads (nama, nrp, original_filename, s3_filename, s3_url, file_size) VALUES (?, ?, ?, ?, ?, ?)`;
      const insertValues = [nama, nrp, req.file.originalname, fileName, s3Result.Location, req.file.size];
      
      console.log('Executing query:', insertQuery);
      console.log('With values:', insertValues);
      
      await connection.execute(insertQuery, insertValues);
      await connection.end();
      console.log('✅ Database save successful');
    } catch (dbError) {
      console.error('❌ Database save failed:', dbError);
      console.error('Error code:', dbError.code);
      console.error('Error message:', dbError.message);
      console.error('SQL State:', dbError.sqlState);
      // Continue execution - don't fail the whole upload
    }

    // Hapus file lokal
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: "Tugas berhasil diupload ke S3!",
      data: {
        nama: nama,
        nrp: nrp,
        fileName: req.file.originalname,
        location: s3Result.Location
      }
    });

  } catch (err) {
    console.error('Upload Error:', err);
    // Hapus file lokal jika ada error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: "Error saat mengunggah file: " + err.message
    });
  }
});

// Test database connection dan cek tabel
app.get('/test-db', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // Test koneksi
    await connection.execute('SELECT 1 as test');
    console.log('✅ Database connection successful');
    
    // Cek apakah tabel uploads ada
    const [tables] = await connection.execute("SHOW TABLES LIKE 'uploads'");
    if (tables.length === 0) {
      console.log('❌ Table "uploads" does not exist');
      // Buat tabel otomatis
      await connection.execute(`
        CREATE TABLE uploads (
          id INT PRIMARY KEY AUTO_INCREMENT,
          nama VARCHAR(255) NOT NULL,
          nrp VARCHAR(50) NOT NULL,
          original_filename VARCHAR(255) NOT NULL,
          s3_filename VARCHAR(255) NOT NULL,
          s3_url TEXT NOT NULL,
          file_size BIGINT,
          upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Table "uploads" created successfully');
    } else {
      console.log('✅ Table "uploads" exists');
      
      // Show struktur tabel
      const [columns] = await connection.execute("DESCRIBE uploads");
      console.log('Table structure:', columns.map(col => col.Field));
    }
    
    await connection.end();
    res.json({ 
      success: true, 
      message: 'Database connection successful',
      tableExists: tables.length > 0
    });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed', 
      error: err.message,
      code: err.code
    });
  }
});

app.listen(port, () => {
  console.log('Server berjalan di http://localhost:3000');
});