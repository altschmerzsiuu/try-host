require('dotenv').config();
const Joi = require('joi');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Setup Supabase Client
const supabase = createClient(
    'https://offtrqgdwscapkolisfm.supabase.co', // Ganti dengan URL Supabase kamu
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZnRycWdkd3NjYXBrb2xpc2ZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczOTQwOTE5MSwiZXhwIjoyMDU0OTg1MTkxfQ.XcHggF3Jpsw0pAmSAutb_SXuV31y0FHgMyQvEh8St6M'  // Ganti dengan API Key Supabase kamu
  );

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

// Endpoint: Mengirim data RFID via SSE
let rfidData = null;

// Endpoint untuk menerima data RFID dari ESP8266 dan menyimpan ke database
app.post('/rfid', async (req, res) => {
    const { rfid_code, nama, info_tambahan, waktu_scan } = req.body;
    try {
        // Simpan data ke Supabase atau PostgreSQL
        const { data, error } = await supabase
            .from('hewan')
            .insert([{ rfid_code, nama, info_tambahan, waktu_scan }]);

        if (error) throw error;

        rfidData = { rfid_code, nama, info_tambahan, waktu_scan };

        // Kirimkan data melalui SSE ke klien
        res.status(200).send('Data diterima');
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Terjadi kesalahan di server' });
    }
});

// Endpoint untuk mengirimkan data secara real-time (SSE)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Kirimkan data RFID ke klien setiap 1 detik
    const sendData = () => {
        if (rfidData) {
            res.write(`data: ${JSON.stringify(rfidData)}\n\n`);
        }
        setTimeout(sendData, 1000);
    };

    sendData();
});

// Memperbarui data hewan
app.put('/hewan/:id', async (req, res) => {
    const { id } = req.params;
    const { nama, jenis, usia, status_kesehatan } = req.body;
    try {
        const { data, error } = await supabase
          .from('hewan')
          .update({ nama, jenis, usia, status_kesehatan })
          .eq('id', id);

        if (error) throw error;

        if (data.length > 0) {
            res.status(200).json(data[0]);
        } else {
            res.status(404).json({ message: 'Hewan tidak ditemukan dengan ID tersebut' });
        }
    } catch (err) {
        console.error(err);
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
