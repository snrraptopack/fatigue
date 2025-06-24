import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { processSyncQueue, processFleetSyncQueue } from '$lib/storage';

export const POST: RequestHandler = async () => {
  try {
    console.log('Manual sync triggered');

    // Process both fatigue alerts and fleet data sync queues
    const [alertSyncResult, fleetSyncResult] = await Promise.all([
      processSyncQueue(),
      processFleetSyncQueue()
    ]);

    const totalProcessed = alertSyncResult.successCount + fleetSyncResult.successCount;
    const totalFailed = alertSyncResult.failCount + fleetSyncResult.failCount;
    const totalSkipped = alertSyncResult.skippedCount + fleetSyncResult.skippedCount;

    console.log('Manual sync completed:', {
      alerts: alertSyncResult,
      fleet: fleetSyncResult,
      total: { processed: totalProcessed, failed: totalFailed, skipped: totalSkipped }
    });

    return json({
      success: true,
      message: 'Manual sync completed successfully',
      results: {
        alerts: alertSyncResult,
        fleet: fleetSyncResult,
        summary: {
          totalProcessed,
          totalFailed,
          totalSkipped
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
        fleet: 'GET /api/admin/fleet'
      }
    });
  } catch (error) {
    console.error('Error getting sync info:', error);
    return json({ error: 'Failed to get sync info' }, { status: 500 });
  }
}; 