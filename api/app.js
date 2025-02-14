require('dotenv').config();
const Joi = require('joi');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use(cors({
    origin: "*", // Sesuaikan dengan domain frontend jika perlu
    methods: ["GET", "POST", "PUT", "DELETE"]
}));

app.use(express.static(path.join(__dirname, '../frontend')));

// Koneksi PostgreSQL dengan Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Pastikan SSL diaktifkan jika menggunakan Supabase atau Render
    }
});

// WebSocket connection handling
wss.on("connection", (ws) => {
    console.log("Client WebSocket connected");

    ws.on("message", (message) => {
        console.log(`Received: ${message}`);
        ws.send(`Echo: ${message}`);
    });

    ws.on("close", () => {
        console.log("Client WebSocket disconnected");
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
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ event: "update_hewan", data: result.rows }));
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Endpoint: Tambah data hewan
app.post('/hewan', async (req, res) => {
    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }

    const { id, nama, jenis, usia, status_kesehatan } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO hewan (id, nama, jenis, usia, status_kesehatan) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, nama, jenis, usia, status_kesehatan]
        );
        res.status(201).json(result.rows[0]);

        // Kirim update ke WebSocket
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ event: "new_hewan", data: result.rows[0] }));
            }
        });

    } catch (err) {
        console.error("Kesalahan di server:", err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
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
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ event: "update_hewan", data: result.rows[0] }));
                }
            });

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
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ event: "delete_hewan", data: { id } }));
                }
            });

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