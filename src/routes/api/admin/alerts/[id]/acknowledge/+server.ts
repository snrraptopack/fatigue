import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { connectDB } from '$lib/server/mongodb';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const alertId = params.id;
    
    if (!alertId) {
      return json({ error: 'Alert ID required' }, { status: 400 });
    }

    try {
      // Try to get alert from MongoDB
      const db = await connectDB();
      const alertsCollection = db.collection('alerts');
      
      const alert = await alertsCollection.findOne({ id: alertId });
      
      if (!alert) {
        return json({ error: 'Alert not found' }, { status: 404 });
      }
      
      return json({ alert });
    } catch (dbError) {
      console.error('MongoDB error:', dbError);
      return json({ error: 'Database error' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error fetching alert:', error);
    return json({ error: 'Failed to fetch alert' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params }) => {
  try {
    const alertId = params.id;
    
    if (!alertId) {
      return json({ error: 'Alert ID required' }, { status: 400 });
    }

    try {
      // Try to acknowledge alert in MongoDB
      const db = await connectDB();
      const alertsCollection = db.collection('alerts');
      
      const result = await alertsCollection.updateOne(
        { id: alertId },
        { 
          $set: { 
            acknowledged: true,
            acknowledgedAt: Date.now()
          }
        }
      );
      
      if (result.matchedCount === 0) {
        return json({ error: 'Alert not found' }, { status: 404 });
      }
      
      return json({ 
        success: true, 
        message: 'Alert acknowledged successfully' 
      });
    } catch (dbError) {
      console.error('MongoDB error:', dbError);
      return json({ error: 'Database error' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    return json({ error: 'Failed to acknowledge alert' }, { status: 500 });
  }
};
