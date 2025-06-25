import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { processSyncQueue, processDriverSyncQueue } from '$lib/storage';

export const POST: RequestHandler = async () => {
  try {
    console.log('Manual sync triggered');

    // Process both fatigue alerts and driver sync queues
    const alertSyncResult = await processSyncQueue();
    await processDriverSyncQueue();

    console.log('Manual sync completed:', {
      alerts: alertSyncResult || { successCount: 0, failCount: 0, skippedCount: 0 },
      drivers: 'processed'
    });

    return json({
      success: true,
      message: 'Manual sync completed successfully',
      results: {
        alerts: alertSyncResult,
        drivers: 'Driver sync queue processed',
        summary: {
          totalProcessed: alertSyncResult?.successCount || 0,
          totalFailed: alertSyncResult?.failCount || 0,
          totalSkipped: alertSyncResult?.skippedCount || 0
        }
      }
    });

  } catch (error) {
    console.error('Error during manual sync:', error);
    return json({ 
      error: 'Manual sync failed', 
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
};

export const GET: RequestHandler = async () => {
  try {
    // Return sync status information
    return json({
      message: 'Sync endpoint is available',
      endpoints: {
        manual: 'POST /api/admin/sync',
        alerts: 'GET /api/admin/alerts',
        drivers: 'GET /api/admin/drivers'
      }
    });
  } catch (error) {
    console.error('Error getting sync info:', error);
    return json({ error: 'Failed to get sync info' }, { status: 500 });
  }
}; 