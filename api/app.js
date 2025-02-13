require('dotenv').config();
const Joi = require('joi');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http'); // Tambahkan http
const socketIo = require('socket.io'); // Tambahkan socket.io

const app = express();
const port =  process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(cors());

app.use(express.static(path.join(__dirname, '../frontend')));

// Koneksi PostgreSQL dengan Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Ini akan mengambil URL dari .env jika sudah didefinisikan
    ssl: {
        rejectUnauthorized: false, // Pastikan SSL diaktifkan di Supabase
    }
});

// Validasi schema dengan Joi (lebih fleksibel)
const schema = Joi.object({
    id: Joi.string().trim().min(1).required(),  // Tambahkan id agar bisa divalidasi
    nama: Joi.string().trim().min(1).required(),
    jenis: Joi.string().trim().min(1).required(),
    usia: Joi.number().integer().min(0).required(),
    status_kesehatan: Joi.string().trim().min(3).required(),
});

const server = http.createServer(app); // Ganti app.listen dengan http.createServer
const io = socketIo(server); // Inisialisasi Socket.IO

// Ketika ada koneksi baru
io.on('connection', (socket) => {
    console.log('User terhubung ke WebSocket');
    
    // Kirim pesan atau data ketika ada event 'hewan-added'
    socket.on('hewan-added', (data) => {
        console.log('Data hewan ditambahkan:', data);
        // Kirimkan data ke klien (misalnya mengirim data hewan setelah berhasil disimpan)
        socket.emit('hewan-updated', data);
    });

    socket.on('disconnect', () => {
        console.log('User terputus');
    });
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
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Endpoint: Tambah data hewan
app.post('/hewan', async (req, res) => {
    console.log("Data yang diterima di backend:", req.body); // Debugging

    const { error } = schema.validate(req.body);
    if (error) {
        console.log("Validasi gagal:", error.details[0].message);
        return res.status(400).json({ message: error.details[0].message });
    }

    const { id, nama, jenis, usia, status_kesehatan } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO hewan (id, nama, jenis, usia, status_kesehatan) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, nama, jenis, usia, status_kesehatan]
        );
        console.log("Data berhasil dimasukkan ke PostgreSQL:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Kesalahan di server:", err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});


// Endpoint: Tambah data hewan berdasarkan RFID UID
app.post('/hewan', async (req, res) => {
    console.log("Data yang diterima di backend:", req.body); // Debugging

    // Validasi hanya untuk 'id' (UID dari kartu RFID)
    const schema = Joi.object({
        id: Joi.string().required(), // Hanya ID yang wajib
    });

    const { error } = schema.validate(req.body);
    if (error) {
        console.log("Validasi gagal:", error.details[0].message);
        return res.status(400).json({ message: error.details[0].message });
    }

    const { id } = req.body; // Hanya ambil ID dari request

    try {
        const result = await pool.query(
            'INSERT INTO hewan (id) VALUES ($1) RETURNING *', 
            [id] // Hanya ID yang dimasukkan
        );
        console.log("Data berhasil dimasukkan ke PostgreSQL:", result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Kesalahan di server:", err);
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
        } else {
            res.status(404).json({ message: 'Hewan tidak ditemukan' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Jalankan server
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
