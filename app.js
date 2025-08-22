const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { AWS, dbConfig } = require('./config');

const app = express();
const s3 = new AWS.S3();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('views'));

// Route untuk halaman utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Route untuk halaman files
app.get('/files', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'list-files.html'));
});

// API endpoint untuk mendapatkan list files dari Database (fallback ke S3)
app.get('/api/files', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      'SELECT * FROM uploads ORDER BY upload_date DESC'
    );
    await connection.end();
    const files = rows.map(row => ({
      id: row.id,
      name: row.s3_filename,
      originalName: row.original_filename,
      nama: row.nama,
      nrp: row.nrp,
      size: formatFileSize(row.file_size),
      uploadDate: formatDate(row.upload_date),
      url: row.s3_url,
      status: row.status || 'original'
    }));
    res.json(files);
  } catch (dbError) {
    // Fallback: ambil dari S3 langsung
    try {
      const params = { Bucket: process.env.S3_BUCKET_NAME };
      const data = await s3.listObjectsV2(params).promise();
      const files = data.Contents.map(file => ({
        name: file.Key,
        originalName: file.Key,
        nama: 'Unknown',
        nrp: 'Unknown',
        size: formatFileSize(file.Size),
        uploadDate: formatDate(file.LastModified),
        url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${file.Key}`
      }));
      res.json(files);
    } catch (s3Error) {
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

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  const { nama, nrp } = req.body;
  if (!nama || !nrp) {
    return res.status(400).json({ success: false, message: 'Nama dan NRP harus diisi' });
  }
  let status = 'original';
  let plagiarismChecked = false;
  let plagiarismError = null;
  let connection;
  try {
    // 1. Cek plagiarisme: apakah sudah ada file dengan original_filename sama (oleh siapapun)
    connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
      'SELECT id FROM uploads WHERE original_filename = ? LIMIT 1',
      [req.file.originalname]
    );
    // Jika sudah ada file dengan nama sama (siapapun penguploadnya), status duplikat
    if (rows.length > 0) {
      status = 'duplikat';
      plagiarismChecked = true;
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      await connection.end();
      return res.json({
        success: false,
        message: 'File dengan nama yang sama sudah pernah diupload oleh mahasiswa lain. Upload dibatalkan. Status: Duplikat.',
        data: { nama, nrp, fileName: req.file.originalname, status },
        plagiarismChecked: true
      });
    }
    plagiarismChecked = true;

    // 2. Upload ke S3
    const fileContent = fs.readFileSync(req.file.path);
    const sanitizedNama = nama.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${sanitizedNama}_${nrp}_${req.file.originalname}`;
    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileName,
      Body: fileContent
    };
    const s3Result = await s3.upload(params).promise();

    // 3. Simpan ke database beserta status
    const insertQuery = `INSERT INTO uploads (nama, nrp, original_filename, s3_filename, s3_url, file_size, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const insertValues = [nama, nrp, req.file.originalname, fileName, s3Result.Location, req.file.size, status];
    await connection.execute(insertQuery, insertValues);
    await connection.end();

    fs.unlinkSync(req.file.path);
    res.json({
      success: true,
      message: 'Tugas berhasil diupload!',
      data: { nama, nrp, fileName: req.file.originalname, location: s3Result.Location, status },
      plagiarismChecked: true
    });
  } catch (err) {
    plagiarismError = err.message;
    if (connection) {
      try { await connection.end(); } catch (e) {}
    }
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Error saat mengunggah file: ' + err.message, plagiarismChecked, plagiarismError });
  }
});

// Test database connection dan cek tabel
app.get('/test-db', async (req, res) => {
  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute('SELECT 1 as test');
    const [tables] = await connection.execute("SHOW TABLES LIKE 'uploads'");
    if (tables.length === 0) {
      await connection.execute(`
        CREATE TABLE uploads (
          id INT PRIMARY KEY AUTO_INCREMENT,
          nama VARCHAR(255) NOT NULL,
          nrp VARCHAR(50) NOT NULL,
          original_filename VARCHAR(255) NOT NULL,
          s3_filename VARCHAR(255) NOT NULL,
          s3_url TEXT NOT NULL,
          file_size BIGINT,
          upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          status ENUM('original','duplikat') DEFAULT 'original'
        )
      `);
    }
    await connection.end();
    res.json({ success: true, message: 'Database connection successful', tableExists: tables.length > 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database connection failed', error: err.message, code: err.code });
  }
});

module.exports = app;
