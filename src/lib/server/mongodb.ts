import { MongoClient, Db } from 'mongodb';
import { MONGODB_URI, MONGODB_DB_NAME } from '$env/static/private';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (db) {
    return db;
  }

  try {
    if (!client) {
      client = new MongoClient(MONGODB_URI || 'mongodb://localhost:27017/fatigue-detection');
      await client.connect();
      console.log('Connected to MongoDB');
    }

    db = client.db(MONGODB_DB_NAME || 'fatigue-detection');

    // Create indexes for better performance
    await createIndexes(db);

    return db;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

async function createIndexes(database: Db) {
  try {
    const alertsCollection = database.collection('alerts');
    const driversCollection = database.collection('drivers');
    const recordingsCollection = database.collection('recordings');

    // Create indexes for alerts collection
    await alertsCollection.createIndex({ timestamp: -1 });
    await alertsCollection.createIndex({ driverName: 1, timestamp: -1 });
    await alertsCollection.createIndex({ severity: 1, acknowledged: 1 });
    await alertsCollection.createIndex({ vehicleId: 1, timestamp: -1 });
    await alertsCollection.createIndex({ scenario: 1 });

    // Create indexes for drivers collection
    await driversCollection.createIndex({ driverId: 1 }, { unique: true });
    await driversCollection.createIndex({ lastSeen: -1 });
    await driversCollection.createIndex({ status: 1 });

    // Create indexes for recordings collection
    await recordingsCollection.createIndex({ driverId: 1, timestamp: -1 });
    await recordingsCollection.createIndex({ timestamp: -1 });
    await recordingsCollection.createIndex({ alertId: 1 }, { sparse: true });

    console.log('Database indexes created successfully');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('Disconnected from MongoDB');
  }
}

// Handle graceful shutdown
// if (typeof process !== 'undefined') {
//   process.on('SIGINT', closeDB);
//   process.on('SIGTERM', closeDB);
// }

export { db };
