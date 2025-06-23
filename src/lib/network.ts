import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { processSyncQueue } from './storage';

// WebSocket connection store
export const activeWebSocketConnection = writable<WebSocket | null>(null);

// Network status store
export const networkStatus = writable({
  online: browser ? navigator.onLine : true,
  lastOnlineTime: Date.now(),
  lastOfflineTime: null as number | null,
  connectionQuality: 'unknown' as 'unknown' | 'poor' | 'fair' | 'good',
  latency: null as number | null,
  reconnectAttempts: 0,
  isReconnecting: false,
  lastReconnectTime: null as number | null,
  syncStatus: 'idle' as 'idle' | 'syncing' | 'success' | 'error',
  syncError: null as string | null,
  syncProgress: 0,
  syncTotal: 0,
  syncCompleted: 0,
  lastSyncTime: null as number | null,
  diagnostics: [] as NetworkDiagnostic[],
  // New fields for enhanced monitoring
  consecutiveFailures: 0,
  lastSuccessfulSync: null as number | null,
  syncRetryScheduled: false,
  syncRetryTime: null as number | null,
  notificationShown: false
});

// Derived store for simplified connection status
export const connectionStatus = derived(
  networkStatus,
  ($networkStatus) => {
    if (!$networkStatus.online) return 'offline';
    if ($networkStatus.isReconnecting) return 'reconnecting';
    if ($networkStatus.connectionQuality === 'poor') return 'poor';
    if ($networkStatus.connectionQuality === 'fair') return 'fair';
    if ($networkStatus.connectionQuality === 'good') return 'good';
    return 'unknown';
  }
);

// Network diagnostic entry
interface NetworkDiagnostic {
  timestamp: number;
  type: 'connection' | 'latency' | 'sync' | 'error';
  message: string;
  details?: any;
}

// Maximum number of diagnostics to keep
const MAX_DIAGNOSTICS = 100;

// Add a diagnostic entry
function addDiagnostic(type: 'connection' | 'latency' | 'sync' | 'error', message: string, details?: any) {
  networkStatus.update(status => {
    const newDiagnostic: NetworkDiagnostic = {
      timestamp: Date.now(),
      type,
      message,
      details
    };

    // Add to beginning of array and limit size
    const diagnostics = [newDiagnostic, ...status.diagnostics].slice(0, MAX_DIAGNOSTICS);

    return {
      ...status,
      diagnostics
    };
  });
}

// Initialize network monitoring with enhanced features
export function initNetworkMonitoring() {
  if (!browser) return;

  // Initial state
  networkStatus.update(status => ({
    ...status,
    online: navigator.onLine
  }));

  // Listen for online/offline events
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Start periodic connection quality checks
  startConnectionQualityChecks();

  // Start periodic sync checks to ensure data is synced
  startPeriodicSyncChecks();

  return () => {
    // Cleanup
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    stopConnectionQualityChecks();
    stopPeriodicSyncChecks();
  };
}

// Interval for periodic sync checks
let syncCheckInterval: number | undefined;

// Start periodic sync checks
function startPeriodicSyncChecks() {
  if (!browser) return;

  // Clear any existing interval
  stopPeriodicSyncChecks();

  // Check for pending syncs every 5 minutes
  syncCheckInterval = window.setInterval(checkPendingSyncs, 5 * 60 * 1000);

  // Run an initial check after a short delay
  setTimeout(checkPendingSyncs, 10000);
}

// Stop periodic sync checks
function stopPeriodicSyncChecks() {
  if (syncCheckInterval) {
    clearInterval(syncCheckInterval);
    syncCheckInterval = undefined;
  }
}

// Check for pending syncs and trigger if needed
async function checkPendingSyncs() {
  if (!browser) return;

  try {
    // Get current network status
    const status = get(networkStatus);

    // If we're offline, don't try to sync
    if (!status.online) {
      return;
    }

    // If a sync is already in progress or scheduled, don't start another
    if (status.syncStatus === 'syncing' || status.syncRetryScheduled) {
      return;
    }

    // Check if there are pending items to sync
    const pendingCount = await getPendingSyncCount();

    if (pendingCount > 0) {
      // If there are pending items and we haven't synced recently, trigger a sync
      const now = Date.now();
      const timeSinceLastSync = status.lastSyncTime ? now - status.lastSyncTime : Infinity;

      // If it's been more than 15 minutes since last sync, or we've never synced
      if (timeSinceLastSync > 15 * 60 * 1000) {
        console.log(`Found ${pendingCount} pending items to sync. Starting sync...`);
        syncDataAfterReconnect();
      }
    }
  } catch (error) {
    console.error('Error checking pending syncs:', error);
  }
}

// Get count of pending items to sync
async function getPendingSyncCount(): Promise<number> {
  try {
    // Import dynamically to avoid circular dependencies
    const { getUnsyncedAlerts } = await import('./storage');
    const unsyncedAlerts = await getUnsyncedAlerts();
    return unsyncedAlerts.length;
  } catch (error) {
    console.error('Error getting unsynced alerts count:', error);
    return 0;
  }
}

// Handle online event
function handleOnline() {
  const now = Date.now();

  networkStatus.update(status => ({
    ...status,
    online: true,
    lastOnlineTime: now,
    isReconnecting: false
  }));

  addDiagnostic('connection', 'Connection restored');

  // Trigger sync when coming back online
  syncDataAfterReconnect();
}

// Handle offline event
function handleOffline() {
  const now = Date.now();

  networkStatus.update(status => ({
    ...status,
    online: false,
    lastOfflineTime: now
  }));

  addDiagnostic('connection', 'Connection lost');
}

// Interval for connection quality checks
let connectionQualityInterval: number | undefined;

// Start periodic connection quality checks
function startConnectionQualityChecks() {
  if (!browser) return;

  // Clear any existing interval
  stopConnectionQualityChecks();

  // Check connection quality every 30 seconds
  connectionQualityInterval = window.setInterval(checkConnectionQuality, 30000);

  // Run an initial check
  checkConnectionQuality();
}

// Stop connection quality checks
function stopConnectionQualityChecks() {
  if (connectionQualityInterval) {
    clearInterval(connectionQualityInterval);
    connectionQualityInterval = undefined;
  }
}

// Check connection quality with enhanced reliability
async function checkConnectionQuality() {
  if (!browser) return;

  let status: 'unknown' | 'poor' | 'fair' | 'good' = 'unknown';
  let latency: number | null = null;

  try {
    if (!navigator.onLine) {
      status = 'poor';
    } else {
      // Try multiple endpoints to better assess connection quality
      const endpoints = [
        '/api/admin/ping',
        '/api/admin/ping?t=' + Date.now(), // With cache-busting
        '/api/admin/live-alerts' // Alternative endpoint
      ];

      // Try each endpoint until one succeeds
      for (const endpoint of endpoints) {
        try {
          const start = Date.now();
          const response = await fetch(endpoint, { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' },
            signal: AbortSignal.timeout(3000) // Shorter timeout for faster feedback
          });

          if (response.ok) {
            latency = Date.now() - start;

            // Determine quality based on latency
            if (latency < 150) {
              status = 'good';
            } else if (latency < 400) {
              status = 'fair';
            } else {
              status = 'poor';
            }

            // Successfully got a response, no need to try other endpoints
            break;
          }
        } catch (endpointError) {
          // Continue to the next endpoint
          console.debug('Endpoint check failed:', endpoint, endpointError);
        }
      }

      // If all endpoints failed, set status to poor
      if (status === 'unknown') {
        status = 'poor';
      }

      // Also check WebSocket connection status
      const wsConnection = getActiveWebSocketConnection();
      if (wsConnection && wsConnection.readyState === 1) { // 1 = OPEN
        // If WebSocket is connected but HTTP requests failed, set to fair at minimum
        if (status === 'poor') {
          status = 'fair';
        }
      } else if (status !== 'poor') {
        // If WebSocket is not connected but HTTP is working, downgrade to fair
        status = 'fair';
      }
    }
  } catch (error) {
    console.error('Error checking connection quality:', error);
    status = 'poor';
  }

  // Update network status
  networkStatus.update(currentStatus => ({
    ...currentStatus,
    connectionQuality: status,
    latency
  }));

  // Add diagnostic entry if quality changed
  if (status !== 'unknown' && currentStatus.connectionQuality !== status) {
    addDiagnostic('latency', `Connection quality: ${status}${latency ? ` (${latency}ms)` : ''}`);

    // If connection quality improved from poor, try to sync data
    if (currentStatus.connectionQuality === 'poor' && (status === 'fair' || status === 'good')) {
      scheduleDataSync(2000); // Schedule sync after a short delay
    }
  }
}

// Schedule a data sync with retry mechanism
export function scheduleDataSync(delay: number = 0): void {
  if (!browser) return;

  // Update network status to indicate a sync is scheduled
  networkStatus.update(status => ({
    ...status,
    syncRetryScheduled: true,
    syncRetryTime: Date.now() + delay
  }));

  // Schedule the sync
  setTimeout(() => syncDataAfterReconnect(), delay);
}

// Sync data after reconnecting with enhanced error handling and retry mechanism
export async function syncDataAfterReconnect() {
  if (!browser) return;

  try {
    // Update network status to indicate sync is in progress
    networkStatus.update(status => ({
      ...status,
      syncStatus: 'syncing',
      syncProgress: 0,
      syncError: null,
      syncRetryScheduled: false,
      syncRetryTime: null,
      notificationShown: false
    }));

    addDiagnostic('sync', 'Starting data synchronization');

    // Process sync queue with current WebSocket connection if available
    const wsConnection = getActiveWebSocketConnection();
    const result = await processSyncQueue(wsConnection);

    if (result && result.failCount > 0) {
      // Some items failed to sync
      networkStatus.update(status => {
        const consecutiveFailures = status.syncStatus === 'error' 
          ? status.consecutiveFailures + 1 
          : 1;

        return {
          ...status,
          syncStatus: 'error',
          syncError: `Failed to sync ${result.failCount} items`,
          syncProgress: 100,
          lastSyncTime: Date.now(),
          consecutiveFailures,
          notificationShown: false // Will be set to true when notification is shown
        };
      });

      addDiagnostic('error', `Sync partially completed with ${result.failCount} failures`, result);

      // Show notification about sync failures
      showSyncNotification('warning', `${result.failCount} items failed to sync. Will retry automatically.`);

      // Schedule a retry with exponential backoff
      const currentStatus = get(networkStatus);
      const backoffDelay = Math.min(30000, 1000 * Math.pow(2, currentStatus.consecutiveFailures));
      scheduleDataSync(backoffDelay);
    } else {
      // Sync completed successfully
      networkStatus.update(status => ({
        ...status,
        syncStatus: 'success',
        syncError: null,
        syncProgress: 100,
        lastSyncTime: Date.now(),
        lastSuccessfulSync: Date.now(),
        consecutiveFailures: 0
      }));

      addDiagnostic('sync', 'Sync completed successfully', result);

      // If there were previous failures, show success notification
      const currentStatus = get(networkStatus);
      if (currentStatus.consecutiveFailures > 0) {
        showSyncNotification('success', 'All data synchronized successfully.');
      }
    }
  } catch (error) {
    console.error('Error syncing data after reconnect:', error);

    // Update network status with error information
    networkStatus.update(status => {
      const consecutiveFailures = status.syncStatus === 'error' 
        ? status.consecutiveFailures + 1 
        : 1;

      return {
        ...status,
        syncStatus: 'error',
        syncError: error instanceof Error ? error.message : String(error),
        syncProgress: 0,
        lastSyncTime: Date.now(),
        consecutiveFailures,
        notificationShown: false
      };
    });

    addDiagnostic('error', 'Sync failed', error);

    // Show notification about sync failure
    showSyncNotification('error', 'Failed to sync data. Will retry automatically.');

    // Schedule a retry with exponential backoff
    const currentStatus = get(networkStatus);
    const backoffDelay = Math.min(30000, 1000 * Math.pow(2, currentStatus.consecutiveFailures));
    scheduleDataSync(backoffDelay);
  }
}

// Show a notification about sync status
function showSyncNotification(type: 'success' | 'warning' | 'error', message: string): void {
  if (!browser) return;

  // Mark notification as shown
  networkStatus.update(status => ({
    ...status,
    notificationShown: true
  }));

  // Check if the browser supports notifications
  if ('Notification' in window) {
    // Request permission if needed
    if (Notification.permission === 'granted') {
      // Create and show notification
      const notification = new Notification('Fatigue Monitoring System', {
        body: message,
        icon: '/favicon.png'
      });

      // Close notification after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showSyncNotification(type, message);
        }
      });
    }
  }

  // Also log to console
  if (type === 'success') {
    console.log('Sync notification:', message);
  } else if (type === 'warning') {
    console.warn('Sync notification:', message);
  } else {
    console.error('Sync notification:', message);
  }
}

// Get active WebSocket connection from the store
function getActiveWebSocketConnection(): WebSocket | null {
  return get(activeWebSocketConnection);
}

// Set active WebSocket connection
export function setActiveWebSocketConnection(connection: WebSocket | null): void {
  activeWebSocketConnection.set(connection);

  // If connection is not null, add event listeners to update network status
  if (connection) {
    connection.addEventListener('close', () => {
      // Update network status when connection is closed
      networkStatus.update(status => ({
        ...status,
        connectionQuality: 'poor',
        isReconnecting: true
      }));

      // Add diagnostic entry
      addDiagnostic('connection', 'WebSocket connection closed');
    });

    connection.addEventListener('error', () => {
      // Update network status on error
      networkStatus.update(status => ({
        ...status,
        connectionQuality: 'poor'
      }));

      // Add diagnostic entry
      addDiagnostic('error', 'WebSocket connection error');
    });
  }
}

// Manual sync trigger
export async function manualSync() {
  return syncDataAfterReconnect();
}

// Check if we're currently online
export function isOnline(): boolean {
  if (!browser) return true;
  return navigator.onLine;
}

// Get network diagnostics
export function getNetworkDiagnostics(): NetworkDiagnostic[] {
  let diagnostics: NetworkDiagnostic[] = [];

  networkStatus.subscribe(status => {
    diagnostics = status.diagnostics;
  })();

  return diagnostics;
}

// Clear network diagnostics
export function clearNetworkDiagnostics() {
  networkStatus.update(status => ({
    ...status,
    diagnostics: []
  }));
}
