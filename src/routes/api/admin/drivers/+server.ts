import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { connectDB } from '$lib/server/mongodb';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const status = url.searchParams.get('status');
    const shift = url.searchParams.get('shift');

    // Connect to MongoDB
    const db = await connectDB();
    const driversCollection = db.collection('drivers');

    // Build query based on filters
    let query: any = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (shift && shift !== 'all') {
      query.shift = shift;
    }

    // Fetch drivers from MongoDB
    const driversList = await driversCollection.find(query).toArray();

    // Convert array to object with driverId as key
    const driversObject: Record<string, any> = {};
    for (const driver of driversList) {
      // Update status based on last seen time
      const timeSinceLastSeen = Date.now() - (driver.lastSeen instanceof Date ? driver.lastSeen.getTime() : driver.lastSeen);

      if (timeSinceLastSeen > 5 * 60 * 1000) { // 5 minutes
        driver.status = 'inactive';

        // Update status in database
        await driversCollection.updateOne(
          { driverId: driver.driverId },
          { $set: { status: 'inactive' } }
        );
      }

      driversObject[driver.driverId] = driver;
    }

    return json(driversObject);
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return json({ error: 'Failed to fetch drivers' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const driverData = await request.json();

    const driverId = driverData.id || `${driverData.name.toLowerCase().replace(' ', '-')}-${driverData.vehicleId.toLowerCase()}`;

    // Connect to MongoDB
    const db = await connectDB();
    const driversCollection = db.collection('drivers');

    // Create driver document
    const driver = {
      driverId: driverId,
      name: driverData.name,
      vehicleId: driverData.vehicleId,
      status: driverData.status || 'active',
      lastSeen: new Date(),
      alertCount: driverData.alertCount || 0,
      location: driverData.location || 'Unknown',
      shift: driverData.shift || 'Unknown',
      startTime: driverData.startTime ? new Date(driverData.startTime) : new Date(),
      scenario: driverData.scenario || 'workplace_fatigue'
    };

    // Insert or update driver in MongoDB
    await driversCollection.updateOne(
      { driverId: driverId },
      { $set: driver },
      { upsert: true }
    );

    console.log(`Driver ${driverId} created/updated in MongoDB`);

    return json({ success: true, driver: driver });
  } catch (error) {
    console.error('Error updating driver:', error);
    return json({ error: 'Failed to update driver' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const { driverId, updates } = await request.json();

    // Connect to MongoDB
    const db = await connectDB();
    const driversCollection = db.collection('drivers');

    // Check if driver exists
    const existingDriver = await driversCollection.findOne({ driverId });

    if (existingDriver) {
      // Update lastSeen to current time
      updates.lastSeen = new Date();

      // Convert date strings to Date objects
      if (updates.startTime) {
        updates.startTime = new Date(updates.startTime);
      }

      // Update driver in MongoDB
      const result = await driversCollection.updateOne(
        { driverId },
        { $set: updates }
      );

      if (result.modifiedCount === 0) {
        console.log(`No changes made to driver ${driverId}`);
      } else {
        console.log(`Driver ${driverId} updated in MongoDB`);
      }

      // Get updated driver
      const updatedDriver = await driversCollection.findOne({ driverId });

      return json({ success: true, driver: updatedDriver });
    } else {
      console.log(`Driver ${driverId} not found in MongoDB`);
      return json({ error: 'Driver not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error updating driver:', error);
    return json({ error: 'Failed to update driver' }, { status: 500 });
  }
};
