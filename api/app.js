require('dotenv').config();
const Joi = require('joi');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");

const { createClient } = require('@supabase/supabase-js');
// const io = require('socket.io')(server);

const app = express();
const server = http.createServer(app);

const port = process.env.PORT || 3002;

// Ambil Supabase URL dan Key dari environment variables
const supabaseUrl = process.env.SUPABASE_URL;  // Ambil dari environment variable
const supabaseKey = process.env.SUPABASE_KEY;  // Ambil dari environment variable
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(express.json());
app.use(cors({
    origin: 'https://try-host.onrender.com', // Ganti dengan alamat frontend kamu
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  }));

app.use(express.static(path.join(__dirname, '../frontend')));

// Koneksi PostgreSQL dengan Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});


// Pengecekan koneksi ke database
pool.connect()
    .then(client => {
        client.release();
        console.log('Koneksi ke database berhasil');
    })
    .catch(err => {
        console.error('Error koneksi ke database:', err);
        // Just log the error, no need to send a response here.
    });

// Konfigurasi CORS agar bisa diakses dari frontend
const io = new Server(server, {
    cors: {
        origin: "https://try-host.onrender.com", // Sesuaikan dengan domain frontend
        methods: ["GET", "POST"]
    }
});

// Emit event 'rfid-scanned' ketika RFID dipindai
io.on('connection', (socket) => {
    console.log('A user connected');
    
    socket.on('rfid-scanned', (data) => {
        console.log('RFID scanned:', data);
        
        // Kirim data kembali ke semua klien yang terhubung
        io.emit('rfid-scanned', {
            rfid_code: data.rfid_code,
            nama: data.nama, // Misalnya nama hewan dari database
            info_tambahan: data.info_tambahan, // Misalnya informasi tambahan
            waktu_scan: new Date().toLocaleString() // Menambahkan waktu scan
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

// Validasi schema dengan Joi
const schema = Joi.object({
    id: Joi.string().trim().min(1).required(),
    nama: Joi.string().trim().min(1).required(),
    jenis: Joi.string().trim().min(1).required(),
    usia: Joi.number().integer().min(0).required(),
    status_kesehatan: Joi.string().trim().min(3).required(),
});

// Endpoint: Ambil daftar hewan dengan pagination dan search
app.get('/hewan', async (req, res) => {
    let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'ASC' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    
    const validColumns = ['nama', 'jenis', 'usia', 'status_kesehatan', 'id'];
    order = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    if (!validColumns.includes(sortBy)) {
        return res.status(400).json({ message: 'Kolom sortBy tidak valid' });
    }

    try {
        const offset = (page - 1) * limit;
        const query = `
            SELECT * FROM hewan
            WHERE nama ILIKE $1 OR jenis ILIKE $1
            ORDER BY ${sortBy} ${order}
            LIMIT $2 OFFSET $3
        `;

        const result = await pool.query(query, [`%${search}%`, limit, offset]);
        const countQuery = `SELECT COUNT(*) FROM hewan WHERE nama ILIKE $1 OR jenis ILIKE $1`;
        const totalCount = await pool.query(countQuery, [`%${search}%`]);

        res.json({
            total: parseInt(totalCount.rows[0].count),
            page,
            limit,
            totalPages: Math.ceil(totalCount.rows[0].count / limit),
            data: result.rows,
        });

        // Kirim update ke WebSocket jika ada client yang terhubung
        io.emit("update_hewan", result.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Endpoint untuk ambil daftar hewan dengan pagination, search, dan sorting
app.get('/hewan/rfid', async (req, res) => {
    let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'ASC' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
  
    const validColumns = ['nama', 'jenis', 'usia', 'status_kesehatan', 'id'];
    order = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  
    if (!validColumns.includes(sortBy)) {
      return res.status(400).json({ message: 'Kolom sortBy tidak valid' });
    }
  
    try {
      const offset = (page - 1) * limit;
  
      const query = `
        SELECT * FROM hewan
        WHERE nama ILIKE $1 OR jenis ILIKE $1
        ORDER BY ${sortBy} ${order}
        LIMIT $2 OFFSET $3
      `;
  
      const result = await client.query(query, [`%${search}%`, limit, offset]);
  
      const countQuery = `SELECT COUNT(*) FROM hewan WHERE nama ILIKE $1 OR jenis ILIKE $1`;
      const totalCount = await client.query(countQuery, [`%${search}%`]);
  
      res.json({
        total: parseInt(totalCount.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(totalCount.rows[0].count / limit),
        data: result.rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
  });

// Endpoint: Tambah data hewan
app.post('/hewan', async (req, res) => {
    try {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { id, nama, jenis, usia, status_kesehatan } = req.body;

        // Cek apakah ID sudah digunakan
        const checkQuery = 'SELECT id FROM hewan WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [id]);

        if (checkResult.rows.length > 0) {
            return res.status(400).json({ message: 'ID sudah digunakan, gunakan ID lain' });
        }

        // Masukkan data hewan baru ke database
        const insertQuery = `
            INSERT INTO hewan (id, nama, jenis, usia, status_kesehatan) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *`;
        const result = await pool.query(insertQuery, [id, nama, jenis, usia, status_kesehatan]);

        // Kirim data hewan baru ke semua client via WebSocket
        io.emit("new_hewan", result.rows[0]);

        res.status(201).json({
            message: 'Data hewan berhasil ditambahkan',
            data: result.rows[0]
        });

    } catch (err) {
        console.error("Kesalahan di server:", err);
        res.status(500).json({ message: 'Terjadi kesalahan di server', error: err.message });
    }
});

app.post('/hewan/rfid', async (req, res) => {
    const rfidUid = req.body.rfid_code; // Mengambil rfid_code dari body request
    console.log('Data diterima:', req.body); // Tampilkan data yang dikirim

    try {
        // Query ke database Supabase untuk mencari hewan berdasarkan rfid_code
        const { data, error } = await supabase
            .from('hewan') // Pastikan tabel Anda bernama 'hewan'
            .select('*')
            .eq('rfid_code', rfidUid); // Pastikan 'rfid_code' adalah kolom di tabel 'hewan'

        if (error) {
            console.error('Error querying database:', error);
            return res.status(500).send({ message: 'Terjadi kesalahan saat mengambil data', error: error.message });
        }

        if (data && data.length > 0) {
            const hewan = data[0]; // Ambil data pertama dari hasil query
            // Emit data melalui WebSocket ke frontend
            io.emit('rfid-scanned', {
                rfid_code: rfidUid,
                nama: hewan.nama,
                info_tambahan: hewan.jenis,
                waktu_scan: new Date().toLocaleString()
            });

            // Kirim respons sukses jika data ditemukan
            res.status(200).send('Data diterima');
        } else {
            // Kirim respons 404 jika data tidak ditemukan
            res.status(404).send('Data tidak ditemukan');
        }
    } catch (error) {
        console.error('Error querying database:', error);
        // Kirim respons 500 jika ada error pada database
        res.status(500).send({ message: 'Terjadi kesalahan saat mengambil data', error: error.message });
    }
});

// Endpoint: Update data hewan
app.put('/hewan/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }

    const { nama, jenis, usia, status_kesehatan } = req.body;
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: 'ID tidak valid' });
    }

    try {
        const result = await pool.query(
            'UPDATE hewan SET nama = $1, jenis = $2, usia = $3, status_kesehatan = $4 WHERE id = $5 RETURNING *',
            [nama, jenis, usia, status_kesehatan, id]
        );

        if (result.rows.length > 0) {
            res.status(200).json(result.rows[0]);

            // Kirim update ke WebSocket
            io.emit("update_hewan", result.rows[0]);

        } else {
            res.status(404).json({ message: 'Hewan tidak ditemukan dengan ID tersebut' });
        }
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Endpoint: Hapus data hewan
app.delete('/hewan/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM hewan WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length > 0) {
            res.json({ message: 'Hewan berhasil dihapus' });

            // Kirim update ke WebSocket
            io.emit("delete_hewan", { id });

        } else {
            res.status(404).json({ message: 'Hewan tidak ditemukan' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Jalankan server
server.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});