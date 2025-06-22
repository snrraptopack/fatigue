import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { connectDB } from '$lib/server/mongodb';
import type { FatigueAlert } from '$lib/storage';

// Fallback in-memory storage for when MongoDB is unavailable
let alerts: any[] = [];
let drivers: Record<string, any> = {};
let lastMongoDBError: Date | null = null;

// Function to clear in-memory storage
function clearInMemoryStorage() {
  console.log('Clearing in-memory storage');
  alerts = [];
  drivers = {};
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    // Get query parameters for filtering
    const severity = url.searchParams.get('severity');
    const scenario = url.searchParams.get('scenario');
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    try {
      // Try MongoDB first
      const db = await connectDB();
      const alertsCollection = db.collection('alerts');

      // If we previously had a MongoDB error but now it's working, clear the in-memory storage
      if (lastMongoDBError !== null) {
        console.log('MongoDB connection restored, clearing in-memory storage');
        clearInMemoryStorage();
        lastMongoDBError = null;
      }

      // Build MongoDB query
      const query: any = {};
      if (severity && severity !== 'all') {
        query.severity = severity;
      }
      if (scenario && scenario !== 'all') {
        query.scenario = scenario;
      }

      // Get total count for pagination
      const total = await alertsCollection.countDocuments(query);

      // Get paginated results
      const mongoAlerts = await alertsCollection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();

      return json({
        alerts: mongoAlerts,
        total,
        hasMore: offset + limit < total
      });
    } catch (dbError) {
      console.error('MongoDB error, falling back to in-memory storage:', dbError);
      lastMongoDBError = new Date();

      // Fallback to in-memory storage
      let filteredAlerts = [...alerts];

      if (severity && severity !== 'all') {
        filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
      }

      if (scenario && scenario !== 'all') {
        filteredAlerts = filteredAlerts.filter(alert => alert.scenario === scenario);
      }

      // Sort by timestamp (newest first)
      filteredAlerts.sort((a, b) => b.timestamp - a.timestamp);

      // Apply pagination
      const paginatedAlerts = filteredAlerts.slice(offset, offset + limit);

      return json({
        alerts: paginatedAlerts,
        total: filteredAlerts.length,
        hasMore: offset + limit < filteredAlerts.length
      });
    }
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const clearAll = url.searchParams.get('all') === 'true';

    if (clearAll) {
      // Clear both in-memory storage and MongoDB
      try {
        const db = await connectDB();
        const alertsCollection = db.collection('alerts');
        const driversCollection = db.collection('drivers');

        // Delete all alerts and drivers from MongoDB
        await alertsCollection.deleteMany({});
        await driversCollection.deleteMany({});

        console.log('Cleared all data from MongoDB');
      } catch (dbError) {
        console.error('Failed to clear MongoDB data:', dbError);
        return json({ error: 'Failed to clear MongoDB data' }, { status: 500 });
      }
    }

    // Always clear in-memory storage
    clearInMemoryStorage();

    return json({ success: true, message: 'In-memory storage cleared' });
  } catch (error) {
    console.error('Error clearing storage:', error);
    return json({ error: 'Failed to clear storage' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const alertData = await request.json();

    // Add timestamp and ID if not present
    const alert: FatigueAlert = {
      id: alertData.id || crypto.randomUUID(),
      timestamp: alertData.timestamp || Date.now(),
      driverName: alertData.driverName,
      vehicleId: alertData.vehicleId,
      alertType: alertData.alertType,
      severity: alertData.severity,
      imageDataUrl: alertData.imageDataUrl,
      synced: true, // Mark as synced since it's being saved to database
      acknowledged: false,
      scenario: alertData.scenario,
      duration: alertData.duration,
      confidence: alertData.confidence
    };

    try {
      // Try MongoDB first
      const db = await connectDB();
      const alertsCollection = db.collection('alerts');
      const driversCollection = db.collection('drivers');

      // If we previously had a MongoDB error but now it's working, clear the in-memory storage
      if (lastMongoDBError !== null) {
        console.log('MongoDB connection restored, clearing in-memory storage');
        clearInMemoryStorage();
        lastMongoDBError = null;
      }

      // Save alert to MongoDB
      await alertsCollection.insertOne(alert);

      // Update driver status
      const driverId = `${alert.driverName.toLowerCase().replace(' ', '-')}-${alert.vehicleId.toLowerCase()}`;
      const driverUpdate = {
        driverId,
        name: alert.driverName,
        vehicleId: alert.vehicleId,
        status: alert.severity === 'critical' ? 'critical' : 'alert',
        lastSeen: new Date(alert.timestamp),
        scenario: alert.scenario || 'unknown',
        location: alertData.location || 'Unknown'
      };

      // Upsert driver status
      await driversCollection.updateOne(
        { driverId },
        { 
          $set: driverUpdate,
          $inc: { alertCount: 1 }
        },
        { upsert: true }
      );

    } catch (dbError) {
      console.error('MongoDB error, falling back to in-memory storage:', dbError);
      lastMongoDBError = new Date();

      // Fallback to in-memory storage
      alerts.unshift(alert);

      // Update driver status in memory
      const driverId = `${alert.driverName}-${alert.vehicleId}`;
      drivers[driverId] = {
        id: driverId,
        name: alert.driverName,
        vehicleId: alert.vehicleId,
        status: alert.severity === 'critical' ? 'critical' : 'alert',
        lastSeen: alert.timestamp,
        alertCount: (drivers[driverId]?.alertCount || 0) + 1,
        location: alertData.location || 'Unknown'
      };

      // Keep only last 1000 alerts to prevent memory issues
      if (alerts.length > 1000) {
        alerts = alerts.slice(0, 1000);
      }

      // Mark as unsynced for later retry
      alert.synced = false;
    }

    return json({ success: true, alert });
  } catch (error) {
    console.error('Error creating alert:', error);
    return json({ error: 'Failed to create alert' }, { status: 500 });
  }
};
