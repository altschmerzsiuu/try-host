const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));  // Agar bisa melayani halaman HTML

// Menangani koneksi WebSocket
io.on('connection', (socket) => {
  console.log('A client connected');
  
  // Mengirimkan data RFID saat ada koneksi baru
  socket.on('rfid-scanned', (data) => {
    console.log('Data dari RFID:', data);

    // Kirim data ke semua klien yang terhubung
    io.emit('rfid-scanned', data);
  });

  socket.on('disconnect', () => {
    console.log('A client disconnected');
  });
});

// Menjalankan server pada port yang sudah ditentukan
server.listen(3000, () => {
  console.log('Server berjalan di http://localhost:3000');
});
