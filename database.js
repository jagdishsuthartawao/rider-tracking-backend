const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || './database.json';

// Initialize database structure
let db = {
  riders: [],
  locations: []
};

// Load existing database
if (fs.existsSync(dbPath)) {
  try {
    const data = fs.readFileSync(dbPath, 'utf8');
    db = JSON.parse(data);
  } catch (error) {
    console.error('Error loading database:', error);
  }
} else {
  // Create sample riders
  db.riders = [
    {
      id: 1,
      name: 'John Doe',
      phone: '9876543210',
      email: 'john@example.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 2,
      name: 'Jagdish Suthar',
      phone: '7023204168',
      email: 'jks@gmail.com',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 3,
      name: 'Mike Johnson',
      phone: '9876543212',
      email: 'mike@example.com',
      status: 'inactive',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];
  saveDatabase();
  console.log('Sample riders created');
}

// Save database to file
function saveDatabase() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Database operations
const statements = {
  // Rider operations
  getAllRiders: () => {
    return db.riders;
  },
  
  getRiderById: (id) => {
    return db.riders.find(r => r.id === parseInt(id));
  },
  
  getRiderByPhone: (phone) => {
    return db.riders.find(r => r.phone === phone);
  },
  
  updateRiderStatus: (status, id) => {
    const rider = db.riders.find(r => r.id === parseInt(id));
    if (rider) {
      rider.status = status;
      rider.updated_at = new Date().toISOString();
      saveDatabase();
    }
  },
  
  // Location operations
  insertLocation: (riderId, latitude, longitude, accuracy, speed, heading, timestamp) => {
    const id = db.locations.length > 0 ? Math.max(...db.locations.map(l => l.id)) + 1 : 1;
    const location = {
      id,
      rider_id: parseInt(riderId),
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      timestamp
    };
    db.locations.push(location);
    saveDatabase();
    return { lastInsertRowid: id };
  },
  
  getLatestLocation: (riderId) => {
    const riderLocations = db.locations
      .filter(l => l.rider_id === parseInt(riderId))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return riderLocations[0] || null;
  },
  
  getLocationHistory: (riderId, startTime, endTime) => {
    const startDate = new Date(startTime * 1000);
    const endDate = new Date(endTime * 1000);
    
    return db.locations
      .filter(l => {
        const locDate = new Date(l.timestamp);
        return l.rider_id === parseInt(riderId) && 
               locDate >= startDate && 
               locDate <= endDate;
      })
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  },
  
  getAllLatestLocations: () => {
    const latestLocations = [];
    const activeRiders = db.riders.filter(r => r.status === 'active');
    
    activeRiders.forEach(rider => {
      const riderLocations = db.locations
        .filter(l => l.rider_id === rider.id)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      if (riderLocations.length > 0) {
        latestLocations.push({
          ...riderLocations[0],
          name: rider.name,
          phone: rider.phone,
          status: rider.status
        });
      }
    });
    
    return latestLocations;
  },
  
  deleteOldLocations: () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const initialCount = db.locations.length;
    db.locations = db.locations.filter(l => new Date(l.timestamp) >= thirtyDaysAgo);
    const deletedCount = initialCount - db.locations.length;
    
    if (deletedCount > 0) {
      saveDatabase();
    }
    
    return { changes: deletedCount };
  }
};

module.exports = {
  db,
  statements
};

