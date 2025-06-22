# MongoDB Setup for Fatigue Detection System

## Overview
This system supports both online (MongoDB) and offline (localStorage) operation. The admin dashboard aggregates alerts from multiple driver stations in real-time.

## MongoDB Configuration

### 1. Install MongoDB
```bash
# For Windows (using MongoDB Community Server)
# Download from: https://www.mongodb.com/try/download/community

# For Docker (recommended for development)
docker run -d --name fatigue-mongodb -p 27017:27017 mongo:latest
```

### 2. Database Schema

#### Collections:

**alerts** - Stores all fatigue alerts
```javascript
{
  _id: ObjectId,
  id: String, // UUID from frontend
  timestamp: Date,
  driverName: String,
  vehicleId: String,
  alertType: String, // 'drowsiness', 'eyesClosed', 'headDown', etc.
  severity: String, // 'low', 'medium', 'high', 'critical'
  scenario: String, // 'workplace_fatigue', 'driving_distraction', etc.
  imageDataUrl: String, // Base64 encoded screenshot
  location: Object, // { lat: Number, lng: Number }
  synced: Boolean,
  acknowledged: Boolean,
  duration: Number, // milliseconds
  confidence: Number // 0-1
}
```

**drivers** - Driver information and status
```javascript
{
  _id: ObjectId,
  driverId: String, // Unique driver-vehicle combination
  name: String,
  vehicleId: String,
  status: String, // 'active', 'inactive', 'alert', 'critical'
  lastSeen: Date,
  alertCount: Number,
  location: String,
  shift: String,
  startTime: Date,
  scenario: String
}
```

### 3. Environment Variables
Create `.env` file:
```env
MONGODB_URI=mongodb://localhost:27017/fatigue-detection
MONGODB_DB_NAME=fatigue-detection
ADMIN_API_KEY=your-secure-api-key-here
WEBSOCKET_PORT=3001
```

### 4. Production Setup with MongoDB

#### Install MongoDB Driver
```bash
npm install mongodb
```

#### Update API endpoints to use MongoDB
Replace the mock data in `/src/routes/api/admin/` with actual MongoDB queries:

```javascript
// Example for alerts endpoint
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db(process.env.MONGODB_DB_NAME);

export const GET = async ({ url }) => {
  try {
    const alerts = await db.collection('alerts')
      .find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    
    return json(alerts);
  } catch (error) {
    console.error('MongoDB error:', error);
    return json({ error: 'Database error' }, { status: 500 });
  }
};
```

## Real-time Features

### 1. WebSocket Setup (Production)
For real-time updates, implement WebSocket or MongoDB Change Streams:

```javascript
// Watch for changes in alerts collection
const changeStream = db.collection('alerts').watch([
  { $match: { 'fullDocument.acknowledged': false } }
]);

changeStream.on('change', (change) => {
  // Broadcast to all connected admin clients
  broadcastToAdmins({
    type: 'new_alert',
    data: change.fullDocument
  });
});
```

### 2. Offline Sync Strategy

#### Driver Stations (Offline-first)
1. Store alerts locally in IndexedDB/localStorage
2. Queue API calls when offline
3. Sync when connection is restored
4. Handle conflicts with server data

#### Admin Dashboard (Real-time)
1. Primary data source: MongoDB
2. Fallback: Latest cached data
3. Real-time updates via WebSocket/SSE
4. Offline notification when disconnected

## Security Considerations

### 1. API Authentication
```javascript
// Add to API routes
export const POST = async ({ request, cookies }) => {
  const apiKey = request.headers.get('authorization');
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ... rest of handler
};
```

### 2. Image Storage
For production, consider:
- Storing images in cloud storage (AWS S3, Cloudinary)
- Only storing image URLs in MongoDB
- Image compression and optimization
- Automatic cleanup of old images

### 3. Data Privacy
- Encrypt sensitive data
- Implement data retention policies
- Add user consent mechanisms
- Anonymize data when possible

## Deployment

### 1. Development
```bash
# Start MongoDB
docker-compose up -d mongodb

# Start the app
npm run dev
```

### 2. Production
```bash
# Build the app
npm run build

# Start with PM2
pm2 start ecosystem.config.js
```

### 3. MongoDB Atlas (Cloud)
1. Create MongoDB Atlas cluster
2. Update MONGODB_URI to Atlas connection string
3. Configure network access and security
4. Set up monitoring and backups

## Monitoring & Maintenance

### 1. MongoDB Indexes
```javascript
// Create indexes for better performance
db.alerts.createIndex({ timestamp: -1 });
db.alerts.createIndex({ driverName: 1, timestamp: -1 });
db.alerts.createIndex({ severity: 1, acknowledged: 1 });
db.drivers.createIndex({ driverId: 1 }, { unique: true });
db.drivers.createIndex({ lastSeen: -1 });
```

### 2. Data Cleanup
```javascript
// Clean up old alerts (run as cron job)
db.alerts.deleteMany({
  timestamp: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // 30 days old
});
```

### 3. Backup Strategy
- Daily automated backups
- Point-in-time recovery
- Disaster recovery plan
- Regular backup testing

## Testing

### 1. API Testing
```bash
# Test alert creation
curl -X POST http://localhost:5173/api/admin/alerts \
  -H "Content-Type: application/json" \
  -d '{"driverName":"Test Driver","vehicleId":"TEST-001","alertType":"drowsiness","severity":"high"}'

# Test admin dashboard
curl http://localhost:5173/api/admin/drivers
```

### 2. Load Testing
- Simulate multiple driver stations
- Test concurrent admin connections
- Monitor database performance
- Test offline/online transitions

This setup provides a robust foundation for a production fatigue detection system with proper offline support and real-time admin monitoring.
