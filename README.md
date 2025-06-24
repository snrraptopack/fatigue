# Resilient Fatigue and Fleet Monitoring System

A comprehensive, offline-first monitoring system designed for mining operations that combines real-time fatigue detection using Face API.js with fleet tracking capabilities. The system ensures continuous operation even during network outages through robust offline storage and automatic sync mechanisms.

## 🎯 Project Overview

This system provides:
- **Real-time fatigue detection** using Face API.js running in the browser
- **GPS fleet tracking** with vehicle status monitoring
- **Offline-first architecture** with automatic data sync when network is available
- **Resilient network handling** with exponential backoff and retry logic
- **Comprehensive dashboard** for monitoring and management

## 🛠️ Core Features

### 🔹 1. Offline-First Architecture
- Automatically stores fatigue and fleet data locally during network outages
- Uses IndexedDB for reliable browser-based storage
- Ensures no data loss due to disconnections
- Logs include fatigue alerts, GPS coordinates, diagnostics, and event timestamps

### 🔹 2. Auto-Sync Engine
- Automatically detects network reconnection
- Syncs unsent local records to the central server
- Uses unique IDs and timestamps to prevent data duplication
- Implements exponential backoff retry logic
- Handles both fatigue alerts and fleet data synchronization

### 🔹 3. Real-Time Alert System
- Alerts when:
  - Data sync repeatedly fails
  - A device goes silent (no data or ping)
  - A critical fatigue event is detected
- Alerts appear on the dashboard and can be acknowledged
- Supports multiple alert types: drowsiness, distraction, yawning, eyes closed, etc.

### 🔹 4. Fatigue Detection via Face API.js
- Uses Face API.js running on browser-capable edge devices
- Detects driver fatigue based on facial landmarks (eyes, mouth)
- Monitors eye aspect ratio, yawning, head nodding
- Runs locally (client-side) and triggers alerts immediately
- Fatigue events are stored offline and synced later if network is unavailable

### 🔹 5. Fleet Monitoring and Sync
- Caches and syncs GPS data (lat/lng, speed, accuracy)
- Monitors vehicle status (active, idle, maintenance, offline)
- Tracks fuel level, engine temperature, battery level
- Automatically resumes fleet sync when back online

### 🔹 6. Operator Dashboard
- Web-based interface to monitor fatigue alerts
- Track vehicles in real-time
- View sync status and connection logs
- Filter alerts by date, location, vehicle, or driver
- Network diagnostics and sync history

### 🔹 7. Network Diagnostics
- Logs every network interruption, reconnection, and sync attempt
- Provides insight into network uptime per device
- Tracks average sync delay and connection quality
- Identifies dead zones within the mine site

## 🧱 Target Users
- Mining operations supervisors
- Fleet/logistics managers
- Health and safety officers
- Network/IT support staff

## ⚙️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Fatigue Detection** | Face API.js (JavaScript in-browser) |
| **Frontend** | SvelteKit + TypeScript |
| **Backend API** | SvelteKit API routes |
| **Local Data Buffer** | IndexedDB (via idb-keyval) |
| **Sync Layer** | JavaScript fetch + service worker |
| **Fleet Data Layer** | Geolocation API + simulated vehicle data |
| **Central Database** | MongoDB with fallback to in-memory storage |
| **Maps** | Ready for Leaflet.js/Mapbox integration |
| **Monitoring & Logs** | Built-in diagnostics and sync history |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ or Deno
- MongoDB (optional, system works with in-memory fallback)
- Modern browser with camera access

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fatigue
   ```

2. **Install dependencies**
   ```bash
   # Using npm
   npm install
   
   # Using Deno
   deno task install
   ```

3. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   MONGODB_URI=mongodb://localhost:27017/fatigue-detection
   MONGODB_DB_NAME=fatigue-detection
   ```

4. **Start the development server**
   ```bash
   # Using npm
   npm run dev
   
   # Using Deno
   deno task dev
   ```

5. **Access the application**
   Open your browser and navigate to `http://localhost:5173`

## 📱 Usage

### Driver Setup
1. Enter your driver name and vehicle ID
2. Grant camera permissions for fatigue detection
3. The system will start monitoring automatically

### Dashboard Navigation
- **Fatigue Detection Tab**: Real-time face monitoring and alert generation
- **Fleet Monitor Tab**: GPS tracking and vehicle status (placeholder for full implementation)
- **Network Status Tab**: Connection quality, sync status, and diagnostics

### Network Resilience
- The system automatically handles network interruptions
- Data is stored locally and synced when connection is restored
- Manual sync button available in the Network Status tab

## 🔧 API Endpoints

### Fatigue Alerts
- `GET /api/admin/alerts` - Retrieve fatigue alerts
- `POST /api/admin/alerts` - Create new fatigue alert
- `DELETE /api/admin/alerts` - Clear alerts

### Fleet Data
- `GET /api/admin/fleet` - Retrieve fleet data
- `POST /api/admin/fleet` - Create new fleet data record
- `DELETE /api/admin/fleet` - Clear fleet data

### Sync Operations
- `POST /api/admin/sync` - Trigger manual sync
- `GET /api/admin/sync` - Get sync status

## 📊 Data Models

### Fatigue Alert
```typescript
interface FatigueAlert {
  id: string;
  timestamp: number;
  driverName: string;
  vehicleId: string;
  alertType: 'drowsiness' | 'distraction' | 'yawning' | 'eyesClosed' | 'headDown' | 'headUp' | 'headTilted' | 'noFaceDetected' | 'lookingAway';
  severity: 'low' | 'medium' | 'high' | 'critical';
  imageDataUrl?: string;
  location?: { lat: number; lng: number };
  synced: boolean;
  acknowledged: boolean;
  scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance';
  duration?: number;
  confidence?: number;
}
```

### Fleet Data
```typescript
interface FleetData {
  id: string;
  vehicleId: string;
  driverId: string;
  timestamp: number;
  location?: { lat: number; lng: number; accuracy: number };
  speed?: number;
  heading?: number;
  altitude?: number;
  status: 'active' | 'idle' | 'maintenance' | 'offline';
  fuelLevel?: number;
  engineTemp?: number;
  batteryLevel?: number;
  synced: boolean;
  createdAt: number;
}
```

## 🔒 Security Considerations

- Camera access is required for fatigue detection
- Data is stored locally in the browser's IndexedDB
- Network communication uses standard HTTPS
- No sensitive data is transmitted without encryption
- MongoDB connection strings should be kept secure

## 🧪 Testing

The system includes comprehensive testing capabilities:

```bash
# Run tests
npm run test

# Check types
npm run check
```

## 📈 Performance

- Face detection runs at ~6.7 FPS for optimal performance
- Local storage can handle thousands of records
- Sync operations are batched for efficiency
- Network requests use exponential backoff to prevent server overload

## 🔄 Deployment

### Production Build
```bash
npm run build
npm run preview
```

### Environment Variables for Production
```env
MONGODB_URI=your-production-mongodb-uri
MONGODB_DB_NAME=your-production-db-name
NODE_ENV=production
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Check the documentation in the `/docs` folder
- Review the network resilience guide in `NETWORK_RESILIENCE.md`
- Check the MongoDB setup guide in `MONGODB_SETUP.md`
- Review the testing guide in `TESTING_GUIDE.md`

## 🔮 Future Enhancements

- [ ] Real-time map integration for fleet tracking
- [ ] SMS/email alert notifications
- [ ] Advanced analytics and reporting
- [ ] Mobile app companion
- [ ] Integration with existing fleet management systems
- [ ] Machine learning improvements for fatigue detection accuracy
- [ ] Multi-language support
- [ ] Advanced user management and roles

---

**Built with ❤️ for safer mining operations**
