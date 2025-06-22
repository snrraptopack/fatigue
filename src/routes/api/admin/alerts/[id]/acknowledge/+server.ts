import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit'

// Get alerts from the main alerts API
import { alerts } from '../../../alerts/+server';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const alertId = url.pathname.split('/').pop()?.replace('/acknowledge', '');
    
    if (!alertId) {
      return json({ error: 'Alert ID required' }, { status: 400 });
    }
    
    return json({ alertId });
  } catch (error) {
    console.error('Error fetching alert:', error);
    return json({ error: 'Failed to fetch alert' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ url }) => {
  try {
    const urlParts = url.pathname.split('/');
    const alertId = urlParts[urlParts.length - 2]; // Get ID from path like /api/admin/alerts/{id}/acknowledge
    
    if (!alertId) {
      return json({ error: 'Alert ID required' }, { status: 400 });
    }
    
    // In production, this would update the alert in MongoDB
    // For now, we'll simulate the acknowledgment
    console.log(`Alert ${alertId} acknowledged by admin`);
    
    return json({ 
      success: true, 
      message: `Alert ${alertId} has been acknowledged`,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error acknowledging alert:', error);
    return json({ error: 'Failed to acknowledge alert' }, { status: 500 });
  }
};
