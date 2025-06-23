// place files you want to import through the `$lib` alias in this folder.

// Export network-related functions for use in components
export { 
  initNetworkMonitoring, 
  connectionStatus, 
  networkStatus, 
  manualSync, 
  getNetworkDiagnostics,
  clearNetworkDiagnostics,
  scheduleDataSync
} from './network';

// Export storage-related functions
export { 
  getAllAlerts, 
  getUnsyncedAlerts, 
  addAlert, 
  processSyncQueue,
  clearFailedItems,
  getSyncHistory,
  getFailedItems
} from './storage';
