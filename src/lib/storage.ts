
import { get, set, del, keys } from 'idb-keyval';
import { writable } from 'svelte/store';

const ALERTS_STORE = 'fatigue-alerts';
const SYNC_QUEUE = 'sync-queue';
const DRIVERS_STORE = 'drivers';
const VEHICLES_STORE = 'vehicles';
const MODELS_STORE = 'face-api-models';

// Create a store for sync status
export const syncStatus = writable({
  isSyncing: false,
  lastSyncTime: null as number | null,
  pendingCount: 0,
  error: null as string | null
});

export async function getAllAlerts() {
  try {
    return await get(ALERTS_STORE) || [];
  } catch (error) {
    console.error('Error getting alerts:', error);
    return [];
  }
}

export async function getUnsyncedAlerts() {
  try {
    const alerts = await getAllAlerts();
    return alerts.filter(alert => !alert.synced);
  } catch (error) {
    console.error('Error getting unsynced alerts:', error);
    return [];
  }
}

export interface FatigueAlert {
  id: string;
  timestamp: number;
  driverName: string;
  vehicleId: string;
  alertType: 'drowsiness' | 'distraction' | 'yawning' | 'eyesClosed' | 'headDown' | 'headUp' | 'headTilted' | 'noFaceDetected' | 'lookingAway';
  severity: 'low' | 'medium' | 'high' | 'critical';
  imageDataUrl?: string; // Optional screenshot as data URL
  location?: { lat: number; lng: number };
  synced: boolean;
  acknowledged: boolean;
  scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance';
  duration?: number; // Duration of the event in milliseconds
  confidence?: number; // Detection confidence score
}

export async function addAlert(alert: FatigueAlert) {
  try {
    const alerts = await getAllAlerts();

    // Check if alert with this ID already exists
    const existingIndex = alerts.findIndex(a => a.id === alert.id);

    if (existingIndex >= 0) {
      // Update existing alert
      alerts[existingIndex] = alert;
    } else {
      // Add new alert
      alerts.push(alert);
    }

    await set(ALERTS_STORE, alerts);

    // If not synced, add to sync queue
    if (!alert.synced) {
      await addToSyncQueue(alert);
    }

    return alert;
  } catch (error) {
    console.error('Error adding alert:', error);
    throw error;
  }
}

// Add alert to sync queue
async function addToSyncQueue(alert: FatigueAlert) {
  try {
    const queue = await get(SYNC_QUEUE) || [];

    // Check if already in queue
    const existingIndex = queue.findIndex((item: any) => item.id === alert.id);

    if (existingIndex >= 0) {
      // Update existing item
      queue[existingIndex] = alert;
    } else {
      // Add new item
      queue.push(alert);
    }

    await set(SYNC_QUEUE, queue);

    // Update sync status store
    syncStatus.update(status => ({
      ...status,
      pendingCount: queue.length
    }));

    return queue;
  } catch (error) {
    console.error('Error adding to sync queue:', error);
    throw error;
  }
}

// Process sync queue when online
export async function processSyncQueue(wsConnection: WebSocket | null = null) {
  try {
    const queue = await get(SYNC_QUEUE) || [];

    if (queue.length === 0) {
      return;
    }

    // Update sync status
    syncStatus.update(status => ({
      ...status,
      isSyncing: true,
      pendingCount: queue.length,
      error: null
    }));

    let successCount = 0;
    let failCount = 0;

    // Process each item in the queue
    for (const alert of queue) {
      try {
        // Try to sync via WebSocket first (faster)
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
          wsConnection.send(JSON.stringify({
            type: 'sync_alert',
            alert
          }));
          successCount++;
        } else {
          // Fall back to REST API
          const response = await fetch('/api/admin/alerts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(alert)
          });

          if (response.ok) {
            successCount++;
          } else {
            failCount++;
            console.error('Failed to sync alert:', await response.text());
          }
        }
      } catch (error) {
        failCount++;
        console.error('Error syncing alert:', error);
      }
    }

    // If any succeeded, update alerts and sync queue
    if (successCount > 0) {
      // Mark synced alerts
      const alerts = await getAllAlerts();
      const updatedAlerts = alerts.map(alert => {
        const queueItem = queue.find(item => item.id === alert.id);
        if (queueItem) {
          return { ...alert, synced: true };
        }
        return alert;
      });

      await set(ALERTS_STORE, updatedAlerts);

      // Remove synced items from queue
      const newQueue = queue.filter((_, index) => index >= successCount);
      await set(SYNC_QUEUE, newQueue);
    }

    // Update sync status
    syncStatus.update(status => ({
      ...status,
      isSyncing: false,
      lastSyncTime: Date.now(),
      pendingCount: failCount,
      error: failCount > 0 ? `Failed to sync ${failCount} alerts` : null
    }));

    return { successCount, failCount };
  } catch (error) {
    console.error('Error processing sync queue:', error);

    // Update sync status
    syncStatus.update(status => ({
      ...status,
      isSyncing: false,
      error: 'Sync failed: ' + (error instanceof Error ? error.message : String(error))
    }));

    throw error;
  }
}
