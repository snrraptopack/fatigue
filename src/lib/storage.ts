import { get, set } from 'idb-keyval';
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { networkStatus } from './network';

const ALERTS_STORE = 'fatigue-alerts';
const SYNC_QUEUE = 'sync-queue';
const DRIVERS_STORE = 'drivers';
const VEHICLES_STORE = 'vehicles';
const MODELS_STORE = 'face-api-models';
const SYNC_METADATA = 'sync-metadata';

// Maximum size for image data URLs before compression (1MB)
const MAX_IMAGE_SIZE = 1024 * 1024;

// Create a store for sync status
export const syncStatus = writable({
  isSyncing: false,
  lastSyncTime: null as number | null,
  pendingCount: 0,
  error: null as string | null,
  progress: 0,
  total: 0,
  completed: 0
});

// Sync metadata to track sync history and failures
interface SyncMetadata {
  lastSuccessfulSync: number | null;
  failedItems: Array<{
    id: string;
    attempts: number;
    lastAttempt: number;
    error: string;
  }>;
  syncHistory: Array<{
    timestamp: number;
    success: boolean;
    itemsProcessed: number;
    itemsFailed: number;
    error?: string;
  }>;
}

// Initialize sync metadata
async function initSyncMetadata(): Promise<SyncMetadata> {
  try {
    const metadata = await get(SYNC_METADATA);
    if (metadata) {
      return metadata;
    }
  } catch (error) {
    console.error('Error getting sync metadata:', error);
  }

  // Default metadata
  return {
    lastSuccessfulSync: null,
    failedItems: [],
    syncHistory: []
  };
}

// Update sync metadata
async function updateSyncMetadata(updates: Partial<SyncMetadata>): Promise<SyncMetadata> {
  try {
    const metadata = await initSyncMetadata();
    const updatedMetadata = { ...metadata, ...updates };
    await set(SYNC_METADATA, updatedMetadata);
    return updatedMetadata;
  } catch (error) {
    console.error('Error updating sync metadata:', error);
    throw error;
  }
}

// Record a sync attempt
async function recordSyncAttempt(success: boolean, itemsProcessed: number, itemsFailed: number, error?: string): Promise<void> {
  try {
    const metadata = await initSyncMetadata();

    metadata.syncHistory.unshift({
      timestamp: Date.now(),
      success,
      itemsProcessed,
      itemsFailed,
      error
    });

    // Limit history to 50 entries
    if (metadata.syncHistory.length > 50) {
      metadata.syncHistory = metadata.syncHistory.slice(0, 50);
    }

    if (success && itemsFailed === 0) {
      metadata.lastSuccessfulSync = Date.now();
    }

    await set(SYNC_METADATA, metadata);
  } catch (error) {
    console.error('Error recording sync attempt:', error);
  }
}

// Record a failed sync item
async function recordFailedItem(id: string, error: string): Promise<void> {
  try {
    const metadata = await initSyncMetadata();

    const existingIndex = metadata.failedItems.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      // Update existing item
      metadata.failedItems[existingIndex] = {
        ...metadata.failedItems[existingIndex],
        attempts: metadata.failedItems[existingIndex].attempts + 1,
        lastAttempt: Date.now(),
        error
      };
    } else {
      // Add new item
      metadata.failedItems.push({
        id,
        attempts: 1,
        lastAttempt: Date.now(),
        error
      });
    }

    await set(SYNC_METADATA, metadata);
  } catch (error) {
    console.error('Error recording failed item:', error);
  }
}

// Clear failed items
export async function clearFailedItems(): Promise<void> {
  try {
    const metadata = await initSyncMetadata();
    metadata.failedItems = [];
    await set(SYNC_METADATA, metadata);
  } catch (error) {
    console.error('Error clearing failed items:', error);
  }
}

// Get sync history
export async function getSyncHistory(): Promise<SyncMetadata['syncHistory']> {
  try {
    const metadata = await initSyncMetadata();
    return metadata.syncHistory;
  } catch (error) {
    console.error('Error getting sync history:', error);
    return [];
  }
}

// Get failed items
export async function getFailedItems(): Promise<SyncMetadata['failedItems']> {
  try {
    const metadata = await initSyncMetadata();
    return metadata.failedItems;
  } catch (error) {
    console.error('Error getting failed items:', error);
    return [];
  }
}

// Compress image data URL if it's too large
function compressImageDataUrl(dataUrl: string): string {
  if (!dataUrl || !dataUrl.startsWith('data:image')) {
    return dataUrl;
  }

  // Check if the data URL is larger than the maximum size
  const estimatedSize = (dataUrl.length * 3) / 4; // Base64 encoding is ~33% larger than binary
  if (estimatedSize <= MAX_IMAGE_SIZE) {
    return dataUrl;
  }

  try {
    if (!browser) return dataUrl;

    // Create a canvas element
    const canvas = document.createElement('canvas');
    const img = document.createElement('img');

    // Set up a promise to handle the async image loading
    return new Promise<string>((resolve) => {
      img.onload = () => {
        // Calculate new dimensions (reduce by 50%)
        const width = img.width * 0.5;
        const height = img.height * 0.5;

        canvas.width = width;
        canvas.height = height;

        // Draw the image at the reduced size
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl); // Fall back to original if context creation fails
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Get the compressed data URL (JPEG at 70% quality)
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);

        // Clean up
        canvas.remove();

        resolve(compressedDataUrl);
      };

      img.onerror = () => {
        console.error('Error loading image for compression');
        resolve(dataUrl); // Fall back to original on error
      };

      // Set the source to the data URL
      img.src = dataUrl;
    }).catch((error) => {
      console.error('Error compressing image:', error);
      return dataUrl; // Fall back to original on error
    }) as unknown as string;
  } catch (error) {
    console.error('Error in image compression:', error);
    return dataUrl; // Fall back to original on error
  }
}

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
    return alerts.filter((alert: FatigueAlert) => !alert.synced);
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
    // Compress image data URL if present and too large
    if (alert.imageDataUrl) {
      alert.imageDataUrl = await compressImageDataUrl(alert.imageDataUrl);
    }

    const alerts = await getAllAlerts();

    // Check if alert with this ID already exists
    const existingIndex = alerts.findIndex((a: FatigueAlert) => a.id === alert.id);

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

    // Even if there's an error, try to add to sync queue if not synced
    if (!alert.synced) {
      try {
        await addToSyncQueue(alert);
      } catch (syncError) {
        console.error('Error adding to sync queue after storage error:', syncError);
      }
    }

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
      // Add new item with priority based on severity
      // Critical alerts go to the front of the queue
      if (alert.severity === 'critical') {
        queue.unshift(alert);
      } else {
        queue.push(alert);
      }
    }

    await set(SYNC_QUEUE, queue);

    // Update sync status store
    syncStatus.update(status => ({
      ...status,
      pendingCount: queue.length
    }));

    // Update network status store
    networkStatus.update(status => ({
      ...status,
      syncTotal: queue.length
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
      // Update sync status to show no pending items
      syncStatus.update(status => ({
        ...status,
        isSyncing: false,
        pendingCount: 0,
        progress: 100,
        total: 0,
        completed: 0,
        error: null
      }));

      // Record empty sync attempt
      await recordSyncAttempt(true, 0, 0);

      return { successCount: 0, failCount: 0, skippedCount: 0 };
    }

    // Get sync metadata to check for failed items
    const metadata = await initSyncMetadata();

    // Update sync status
    syncStatus.update(status => ({
      ...status,
      isSyncing: true,
      pendingCount: queue.length,
      progress: 0,
      total: queue.length,
      completed: 0,
      error: null
    }));

    // Update network status
    networkStatus.update(status => ({
      ...status,
      syncStatus: 'syncing',
      syncProgress: 0,
      syncTotal: queue.length,
      syncCompleted: 0,
      syncError: null
    }));

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    let processedItems = [];

    // Process each item in the queue with exponential backoff
    for (let i = 0; i < queue.length; i++) {
      const alert = queue[i];

      // Check if this item has failed too many times
      const failedItem = metadata.failedItems.find(item => item.id === alert.id);
      const maxRetries = alert.severity === 'critical' ? 10 : 5; // More retries for critical alerts

      if (failedItem && failedItem.attempts >= maxRetries) {
        // Skip items that have failed too many times
        skippedCount++;
        continue;
      }

      // Calculate backoff delay based on previous attempts
      let backoffDelay = 0;
      if (failedItem) {
        // Exponential backoff: 2^attempts * 1000ms (capped at 30 seconds)
        backoffDelay = Math.min(Math.pow(2, failedItem.attempts) * 1000, 30000);

        // If last attempt was recent, respect the backoff delay
        const timeSinceLastAttempt = Date.now() - failedItem.lastAttempt;
        if (timeSinceLastAttempt < backoffDelay) {
          skippedCount++;
          continue;
        }
      }

      try {
        // Update progress
        const progress = Math.round(((successCount + failCount + skippedCount) / queue.length) * 100);
        syncStatus.update(status => ({
          ...status,
          progress,
          completed: successCount + failCount + skippedCount
        }));

        networkStatus.update(status => ({
          ...status,
          syncProgress: progress,
          syncCompleted: successCount + failCount + skippedCount
        }));

        // Try to sync via WebSocket first (faster)
        if (wsConnection && wsConnection.readyState === 1) { // 1 = OPEN in WebSocket standard
          wsConnection.send(JSON.stringify({
            type: 'sync_alert',
            alert,
            driverId: alert.driverName.toLowerCase().replace(/\s+/g, '-') + '-' + alert.vehicleId.toLowerCase()
          }));

          // Wait for a short time to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 100));

          successCount++;
          processedItems.push(alert.id);
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
            processedItems.push(alert.id);
          } else {
            failCount++;
            const errorText = await response.text();
            console.error('Failed to sync alert:', errorText);
            await recordFailedItem(alert.id, errorText);
          }
        }
      } catch (error) {
        failCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error syncing alert:', errorMessage);
        await recordFailedItem(alert.id, errorMessage);
      }
    }

    // If any succeeded, update alerts and sync queue
    if (successCount > 0) {
      // Mark synced alerts
      const alerts = await getAllAlerts();
      const updatedAlerts = alerts.map((alert: FatigueAlert) => {
        if (processedItems.includes(alert.id)) {
          return { ...alert, synced: true };
        }
        return alert;
      });

      await set(ALERTS_STORE, updatedAlerts);

      // Remove synced items from queue
      const newQueue = queue.filter((alert: FatigueAlert) => !processedItems.includes(alert.id));
      await set(SYNC_QUEUE, newQueue);
    }

    // Final progress update
    const finalProgress = 100;
    syncStatus.update(status => ({
      ...status,
      isSyncing: false,
      lastSyncTime: Date.now(),
      pendingCount: queue.length - successCount,
      progress: finalProgress,
      completed: successCount + failCount + skippedCount,
      error: (failCount > 0 || skippedCount > 0) ? 
        `Failed to sync ${failCount} alerts, skipped ${skippedCount} alerts` : 
        null
    }));

    networkStatus.update(status => ({
      ...status,
      syncStatus: (failCount > 0 || skippedCount > 0) ? 'error' : 'success',
      syncProgress: finalProgress,
      syncCompleted: successCount + failCount + skippedCount,
      lastSyncTime: Date.now(),
      syncError: (failCount > 0 || skippedCount > 0) ? 
        `Failed to sync ${failCount} alerts, skipped ${skippedCount} alerts` : 
        null
    }));

    // Record sync attempt
    await recordSyncAttempt(
      failCount === 0 && skippedCount === 0,
      successCount + failCount + skippedCount,
      failCount,
      (failCount > 0 || skippedCount > 0) ? 
        `Failed to sync ${failCount} alerts, skipped ${skippedCount} alerts` : 
        undefined
    );

    return { successCount, failCount, skippedCount };
  } catch (error) {
    console.error('Error processing sync queue:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update sync status
    syncStatus.update(status => ({
      ...status,
      isSyncing: false,
      error: 'Sync failed: ' + errorMessage
    }));

    // Update network status
    networkStatus.update(status => ({
      ...status,
      syncStatus: 'error',
      syncError: 'Sync failed: ' + errorMessage,
      lastSyncTime: Date.now()
    }));

    // Record sync failure
    await recordSyncAttempt(false, 0, 0, errorMessage);

    throw error;
  }
}

// Driver registration interface extending DriverProfile
export interface DriverRegistration {
  id: string;
  name: string;
  vehicleId: string;
  uniqueDriverId: string; // Combined identifier for consistency
  registeredAt: number;
  lastSeen: number;
  status: 'active' | 'inactive' | 'break' | 'offline';
  shift?: {
    start: number;
    end: number;
  };
  location?: { lat: number; lng: number; accuracy: number };
  photo?: string;
  synced: boolean;
  createdAt: number;
}

// Driver registration functions
export async function registerDriver(driverInfo: {
  driverName: string;
  driverId: string;
  uniqueDriverId: string;
}): Promise<DriverRegistration> {
  try {
    const registration: DriverRegistration = {
      id: crypto.randomUUID(),
      name: driverInfo.driverName,
      vehicleId: driverInfo.driverId,
      uniqueDriverId: driverInfo.uniqueDriverId,
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      status: 'active',
      synced: false,
      createdAt: Date.now()
    };

    // Get existing drivers
    const existingDrivers = await get(DRIVERS_STORE) || [];
    
    // Check if driver already exists (by uniqueDriverId)
    const existingDriverIndex = existingDrivers.findIndex(
      (d: DriverRegistration) => d.uniqueDriverId === registration.uniqueDriverId
    );

    if (existingDriverIndex >= 0) {
      // Update existing driver
      existingDrivers[existingDriverIndex] = {
        ...existingDrivers[existingDriverIndex],
        lastSeen: Date.now(),
        status: 'active',
        synced: false // Mark as needing sync
      };
      await set(DRIVERS_STORE, existingDrivers);
      
      // Add to sync queue
      await addToDriverSyncQueue(existingDrivers[existingDriverIndex]);
      
      console.log('Driver updated:', registration.uniqueDriverId);
      return existingDrivers[existingDriverIndex];
    } else {
      // Add new driver
      const updatedDrivers = [registration, ...existingDrivers];
      await set(DRIVERS_STORE, updatedDrivers);
      
      // Add to sync queue
      await addToDriverSyncQueue(registration);
      
      console.log('New driver registered:', registration.uniqueDriverId);
      return registration;
    }
  } catch (error) {
    console.error('Error registering driver:', error);
    throw error;
  }
}

export async function updateDriverStatus(
  uniqueDriverId: string, 
  updates: Partial<DriverRegistration>
): Promise<void> {
  try {
    const drivers = await get(DRIVERS_STORE) || [];
    const driverIndex = drivers.findIndex(
      (d: DriverRegistration) => d.uniqueDriverId === uniqueDriverId
    );

    if (driverIndex >= 0) {
      drivers[driverIndex] = {
        ...drivers[driverIndex],
        ...updates,
        lastSeen: Date.now(),
        synced: false // Mark as needing sync
      };
      
      await set(DRIVERS_STORE, drivers);
      await addToDriverSyncQueue(drivers[driverIndex]);
      
      console.log('Driver status updated:', uniqueDriverId);
    }
  } catch (error) {
    console.error('Error updating driver status:', error);
    throw error;
  }
}

export async function getDriverByUniqueId(uniqueDriverId: string): Promise<DriverRegistration | null> {
  try {
    const drivers = await get(DRIVERS_STORE) || [];
    return drivers.find((d: DriverRegistration) => d.uniqueDriverId === uniqueDriverId) || null;
  } catch (error) {
    console.error('Error getting driver:', error);
    return null;
  }
}

export async function getAllDrivers(): Promise<DriverRegistration[]> {
  try {
    const drivers = await get(DRIVERS_STORE) || [];
    return drivers;
  } catch (error) {
    console.error('Error getting all drivers:', error);
    return [];
  }
}

// Driver sync queue functions
const DRIVER_SYNC_QUEUE = 'driver-sync-queue';

async function addToDriverSyncQueue(driver: DriverRegistration): Promise<void> {
  try {
    const queue = await get(DRIVER_SYNC_QUEUE) || [];
    
    // Remove existing entry for this driver if exists
    const filteredQueue = queue.filter((item: any) => item.uniqueDriverId !== driver.uniqueDriverId);
    
    // Add updated driver to queue
    filteredQueue.push({
      ...driver,
      queuedAt: Date.now()
    });
    
    await set(DRIVER_SYNC_QUEUE, filteredQueue);
    
    // Update sync status
    const syncQueue = await get(DRIVER_SYNC_QUEUE) || [];
    syncStatus.update(status => ({
      ...status,
      pendingCount: status.pendingCount + syncQueue.length
    }));
  } catch (error) {
    console.error('Error adding driver to sync queue:', error);
  }
}

export async function getUnsyncedDrivers(): Promise<DriverRegistration[]> {
  try {
    const queue = await get(DRIVER_SYNC_QUEUE) || [];
    return queue;
  } catch (error) {
    console.error('Error getting unsynced drivers:', error);
    return [];
  }
}

export async function processDriverSyncQueue(): Promise<void> {
  if (!browser) return;

  try {
    const queue = await getUnsyncedDrivers();
    if (queue.length === 0) return;

    console.log(`Processing ${queue.length} drivers in sync queue`);

    for (const driver of queue) {
      try {
        // Send driver to server
        const response = await fetch('/api/admin/drivers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            driverId: driver.uniqueDriverId,
            updates: {
              name: driver.name,
              vehicleId: driver.vehicleId,
              status: driver.status,
              lastSeen: driver.lastSeen,
              registeredAt: driver.registeredAt,
              shift: driver.shift,
              location: driver.location,
              photo: driver.photo
            }
          })
        });

        if (response.ok) {
          // Mark as synced in local storage
          await updateDriverSyncedStatus(driver.uniqueDriverId, true);
          
          // Remove from sync queue
          await removeFromDriverSyncQueue(driver.uniqueDriverId);
          
          console.log('Driver synced successfully:', driver.uniqueDriverId);
        } else {
          console.error('Failed to sync driver:', driver.uniqueDriverId, response.status);
        }
      } catch (error) {
        console.error('Error syncing driver:', driver.uniqueDriverId, error);
      }
    }

    // Update sync status
    const remainingQueue = await getUnsyncedDrivers();
    syncStatus.update(status => ({
      ...status,
      pendingCount: status.pendingCount + remainingQueue.length
    }));
  } catch (error) {
    console.error('Error processing driver sync queue:', error);
  }
}

async function updateDriverSyncedStatus(uniqueDriverId: string, synced: boolean): Promise<void> {
  try {
    const drivers = await get(DRIVERS_STORE) || [];
    const driverIndex = drivers.findIndex(
      (d: DriverRegistration) => d.uniqueDriverId === uniqueDriverId
    );

    if (driverIndex >= 0) {
      drivers[driverIndex].synced = synced;
      await set(DRIVERS_STORE, drivers);
    }
  } catch (error) {
    console.error('Error updating driver synced status:', error);
  }
}

async function removeFromDriverSyncQueue(uniqueDriverId: string): Promise<void> {
  try {
    const queue = await get(DRIVER_SYNC_QUEUE) || [];
    const filteredQueue = queue.filter((item: any) => item.uniqueDriverId !== uniqueDriverId);
    await set(DRIVER_SYNC_QUEUE, filteredQueue);
  } catch (error) {
    console.error('Error removing driver from sync queue:', error);
  }
}
