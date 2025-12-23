require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { db, statements } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active rider connections
const activeRiders = new Map();

// ============================================
// REST API Endpoints
// ============================================

// Get all riders
app.get('/api/riders', (req, res) => {
  try {
    const riders = statements.getAllRiders();
    res.json({ success: true, data: riders });
  } catch (error) {
    console.error('Error fetching riders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get rider by ID
app.get('/api/riders/:id', (req, res) => {
  try {
    const rider = statements.getRiderById(req.params.id);
    if (!rider) {
      return res.status(404).json({ success: false, error: 'Rider not found' });
    }
    res.json({ success: true, data: rider });
  } catch (error) {
    console.error('Error fetching rider:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Authenticate rider by phone
app.post('/api/riders/auth', (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    const rider = statements.getRiderByPhone(phone);
    if (!rider) {
      return res.status(404).json({ success: false, error: 'Rider not found' });
    }
    
    res.json({ success: true, data: rider });
  } catch (error) {
    console.error('Error authenticating rider:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get location history for a rider
app.get('/api/riders/:id/locations', (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    const riderId = req.params.id;
    
    // Default to last 24 hours if not specified
    const start = startTime ? parseInt(startTime) : Math.floor(Date.now() / 1000) - 86400;
    const end = endTime ? parseInt(endTime) : Math.floor(Date.now() / 1000);
    
    const locations = statements.getLocationHistory(riderId, start, end);
    res.json({ success: true, data: locations });
  } catch (error) {
    console.error('Error fetching location history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest locations for all active riders
app.get('/api/locations/latest', (req, res) => {
  try {
    const locations = statements.getAllLatestLocations();
    res.json({ success: true, data: locations });
  } catch (error) {
    console.error('Error fetching latest locations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save location (REST endpoint as backup to WebSocket)
app.post('/api/locations', (req, res) => {
  try {
    const { riderId, latitude, longitude, accuracy, speed, heading } = req.body;
    
    if (!riderId || !latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        error: 'riderId, latitude, and longitude are required' 
      });
    }
    
    const timestamp = new Date().toISOString();
    const result = statements.insertLocation(
      riderId, 
      latitude, 
      longitude, 
      accuracy || null, 
      speed || null, 
      heading || null,
      timestamp
    );
    
    // Broadcast to all connected admin clients
    io.emit('location-update', {
      riderId,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      timestamp
    });
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (error) {
    console.error('Error saving location:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// WebSocket Events
// ============================================

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Rider connects and starts tracking
  socket.on('rider-connect', (data) => {
    const { riderId, riderName } = data;
    console.log(`Rider connected: ${riderName} (ID: ${riderId})`);
    
    activeRiders.set(riderId, {
      socketId: socket.id,
      name: riderName,
      connectedAt: new Date()
    });
    
    // Update rider status to active
    statements.updateRiderStatus('active', riderId);
    
    // Notify all admin clients
    io.emit('rider-status', {
      riderId,
      riderName,
      status: 'active',
      timestamp: new Date().toISOString()
    });
  });
  
  // Receive location update from rider
  socket.on('location-update', (data) => {
    const { riderId, latitude, longitude, accuracy, speed, heading } = data;
    
    try {
      const timestamp = new Date().toISOString();
      
      // Save to database
      statements.insertLocation(
        riderId,
        latitude,
        longitude,
        accuracy || null,
        speed || null,
        heading || null,
        timestamp
      );
      
      // Get rider info
      const rider = statements.getRiderById(riderId);
      
      // Broadcast to all admin clients
      io.emit('location-update', {
        riderId,
        riderName: rider?.name,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        timestamp
      });
      
      console.log(`Location updated for rider ${riderId}: ${latitude}, ${longitude}`);
    } catch (error) {
      console.error('Error processing location update:', error);
    }
  });
  
  // Rider disconnects
  socket.on('rider-disconnect', (data) => {
    const { riderId } = data;
    
    if (activeRiders.has(riderId)) {
      const rider = activeRiders.get(riderId);
      console.log(`Rider disconnected: ${rider.name} (ID: ${riderId})`);
      
      activeRiders.delete(riderId);
      
      // Update rider status to inactive
      statements.updateRiderStatus('inactive', riderId);
      
      // Notify all admin clients
      io.emit('rider-status', {
        riderId,
        riderName: rider.name,
        status: 'inactive',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find and remove rider if it was a rider connection
    for (const [riderId, riderData] of activeRiders.entries()) {
      if (riderData.socketId === socket.id) {
        console.log(`Rider ${riderData.name} disconnected unexpectedly`);
        activeRiders.delete(riderId);
        statements.updateRiderStatus('inactive', riderId);
        
        io.emit('rider-status', {
          riderId,
          riderName: riderData.name,
          status: 'inactive',
          timestamp: new Date().toISOString()
        });
        break;
      }
    }
  });
});

// ============================================
// Cleanup job - Remove old locations
// ============================================
setInterval(() => {
  try {
    const result = statements.deleteOldLocations();
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old location records`);
    }
  } catch (error) {
    console.error('Error cleaning up old locations:', error);
  }
}, 24 * 60 * 60 * 1000); // Run once per day

// ============================================
// Start Server
// ============================================
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   Rider Tracking Server Running                       ║
╠════════════════════════════════════════════════════════╣
║   Port:          ${PORT}                                    ║
║   Rider App:     http://localhost:${PORT}/rider          ║
║   Admin Panel:   http://localhost:${PORT}/admin          ║
║   API:           http://localhost:${PORT}/api            ║
╚════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
