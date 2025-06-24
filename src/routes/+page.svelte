<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { writable, derived, get } from 'svelte/store';
  import { networkStatus, connectionStatus, initNetworkMonitoring } from '$lib/network';
  import { syncStatus, getSyncHistory, getFailedItems } from '$lib/storage';
  import FatigueDetector from '$lib/component/FatigueDetector.svelte';
  import NetworkStatusIndicator from '$lib/component/NetworkStatusIndicator.svelte';
  import SimpleFleetMonitor from '$lib/component/SimpleFleetMonitor.svelte';
  import { v4 as uuidv4 } from 'uuid';

  // Component state
  let currentTab = 'fatigue';
  let showNetworkDetails = false;
  let showSyncHistory = false;
  let driverName = '';
  let vehicleId = '';
  let driverId = '';

  // Network monitoring cleanup
  let cleanupNetworkMonitoring: (() => void) | null = null;

  // Derived stores for UI
  const networkInfo = derived(networkStatus, ($networkStatus) => ({
    isOnline: $networkStatus.online,
    connectionQuality: $networkStatus.connectionQuality,
    latency: $networkStatus.latency,
    lastSync: $networkStatus.lastSyncTime,
    pendingCount: $networkStatus.syncTotal - $networkStatus.syncCompleted,
    syncStatus: $networkStatus.syncStatus,
    syncError: $networkStatus.syncError
  }));

  const syncInfo = derived(syncStatus, ($syncStatus) => ({
    isSyncing: $syncStatus.isSyncing,
    progress: $syncStatus.progress,
    pendingCount: $syncStatus.pendingCount,
    lastSyncTime: $syncStatus.lastSyncTime,
    error: $syncStatus.error
  }));

  onMount(() => {
    if (browser) {
      // Initialize network monitoring
      cleanupNetworkMonitoring = initNetworkMonitoring();
      
      // Load driver info from localStorage if available
      const savedDriverName = localStorage.getItem('driverName');
      const savedVehicleId = localStorage.getItem('vehicleId');
      
      if (savedDriverName && savedVehicleId) {
        driverName = savedDriverName;
        vehicleId = savedVehicleId;
        driverId = `${driverName.toLowerCase().replace(/\s+/g, '-')}-${vehicleId.toLowerCase()}`;
      }
    }
  });

  onDestroy(() => {
    if (cleanupNetworkMonitoring) {
      cleanupNetworkMonitoring();
    }
  });

  function handleDriverSetup() {
    if (!driverName.trim() || !vehicleId.trim()) {
      alert('Please enter both driver name and vehicle ID');
      return;
    }

    driverId = `${driverName.toLowerCase().replace(/\s+/g, '-')}-${vehicleId.toLowerCase()}`;
    
    // Save to localStorage
    localStorage.setItem('driverName', driverName);
    localStorage.setItem('vehicleId', vehicleId);
    
    // Switch to fatigue detection tab
    currentTab = 'fatigue';
  }

  function toggleNetworkDetails() {
    showNetworkDetails = !showNetworkDetails;
  }

  function toggleSyncHistory() {
    showSyncHistory = !showSyncHistory;
  }

  async function manualSync() {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST'
      });
      
      if (response.ok) {
        console.log('Manual sync triggered successfully');
      } else {
        console.error('Manual sync failed');
      }
    } catch (error) {
      console.error('Error triggering manual sync:', error);
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'good': return '#27ae60';
      case 'fair': return '#f39c12';
      case 'poor': return '#e74c3c';
      case 'offline': return '#95a5a6';
      default: return '#95a5a6';
    }
  }

  function getSyncStatusColor(status: string): string {
    switch (status) {
      case 'success': return '#27ae60';
      case 'error': return '#e74c3c';
      case 'syncing': return '#3498db';
      default: return '#95a5a6';
    }
  }
</script>

<svelte:head>
  <title>Integrated Fatigue & Fleet Monitoring System</title>
</svelte:head>

<div class="dashboard">
  <!-- Header -->
  <header class="dashboard-header">
    <div class="header-content">
      <h1>Integrated Monitoring System</h1>
      <div class="status-indicators">
        <div class="status-item">
          <span class="status-dot" style="background-color: {getStatusColor($networkInfo.isOnline ? $networkInfo.connectionQuality : 'offline')}"></span>
          <span class="status-text">{$connectionStatus}</span>
        </div>
        <div class="status-item">
          <span class="status-dot" style="background-color: {getSyncStatusColor($networkInfo.syncStatus)}"></span>
          <span class="status-text">{$networkInfo.syncStatus}</span>
        </div>
        {#if $networkInfo.pendingCount > 0}
          <div class="pending-badge">
            {$networkInfo.pendingCount} pending
          </div>
        {/if}
      </div>
    </div>
  </header>

  <!-- Driver Setup Modal -->
  {#if !driverName || !vehicleId}
    <div class="setup-modal">
      <div class="setup-content">
        <h2>Driver Setup</h2>
        <p>Please enter your information to start monitoring</p>
        
        <div class="setup-form">
          <div class="form-group">
            <label for="driverName">Driver Name:</label>
            <input 
              type="text" 
              id="driverName" 
              bind:value={driverName} 
              placeholder="Enter your full name"
              required
            />
          </div>
          
          <div class="form-group">
            <label for="vehicleId">Vehicle ID:</label>
            <input 
              type="text" 
              id="vehicleId" 
              bind:value={vehicleId} 
              placeholder="Enter vehicle ID"
              required
            />
          </div>
          
          <button class="setup-btn" on:click={handleDriverSetup}>
            Start Monitoring
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Main Dashboard Content -->
    <div class="dashboard-content">
      <!-- Navigation Tabs -->
      <nav class="tab-navigation">
        <button 
          class="tab-btn {currentTab === 'fatigue' ? 'active' : ''}" 
          on:click={() => currentTab = 'fatigue'}
        >
          Fatigue Detection
        </button>
        <button 
          class="tab-btn {currentTab === 'fleet' ? 'active' : ''}" 
          on:click={() => currentTab = 'fleet'}
        >
          Fleet Monitor
        </button>
        <button 
          class="tab-btn {currentTab === 'network' ? 'active' : ''}" 
          on:click={() => currentTab = 'network'}
        >
          Network Status
        </button>
      </nav>

      <!-- Tab Content -->
      <div class="tab-content">
        {#if currentTab === 'fatigue'}
          <div class="fatigue-tab">
            <div class="tab-header">
              <h2>Fatigue Detection</h2>
              <div class="driver-info">
                <span class="driver-name">{driverName}</span>
                <span class="vehicle-id">{vehicleId}</span>
              </div>
            </div>
            
            <FatigueDetector {driverName} {vehicleId} />
          </div>
        {:else if currentTab === 'fleet'}
          <div class="fleet-tab">
            <div class="tab-header">
              <h2>Fleet Monitoring</h2>
              <div class="driver-info">
                <span class="driver-name">{driverName}</span>
                <span class="vehicle-id">{vehicleId}</span>
              </div>
            </div>
            
            <SimpleFleetMonitor {vehicleId} {driverId} />
          </div>
        {:else if currentTab === 'network'}
          <div class="network-tab">
            <div class="tab-header">
              <h2>Network & Sync Status</h2>
              <button class="sync-btn" on:click={manualSync} disabled={$syncInfo.isSyncing}>
                {#if $syncInfo.isSyncing}
                  Syncing...
                {:else}
                  Manual Sync
                {/if}
              </button>
            </div>

            <NetworkStatusIndicator />

            <div class="network-actions">
              <button class="action-btn" on:click={toggleNetworkDetails}>
                {showNetworkDetails ? 'Hide' : 'Show'} Network Details
              </button>
              <button class="action-btn" on:click={toggleSyncHistory}>
                {showSyncHistory ? 'Hide' : 'Show'} Sync History
              </button>
            </div>

            {#if showNetworkDetails}
              <div class="network-details">
                <h3>Network Diagnostics</h3>
                <div class="diagnostics-list">
                  {#each $networkStatus.diagnostics.slice(0, 10) as diagnostic}
                    <div class="diagnostic-item">
                      <span class="diagnostic-time">
                        {new Date(diagnostic.timestamp).toLocaleTimeString()}
                      </span>
                      <span class="diagnostic-type">{diagnostic.type}</span>
                      <span class="diagnostic-message">{diagnostic.message}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if showSyncHistory}
              <div class="sync-history">
                <h3>Sync History</h3>
                <div class="history-list">
                  <!-- Sync history will be loaded here -->
                  <p>Sync history will be displayed here</p>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }

  .dashboard-header {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding: 1rem 2rem;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1200px;
    margin: 0 auto;
  }

  .header-content h1 {
    margin: 0;
    color: #2c3e50;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .status-indicators {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-text {
    font-size: 0.9rem;
    color: #2c3e50;
    text-transform: capitalize;
  }

  .pending-badge {
    background: #e74c3c;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .setup-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .setup-content {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    max-width: 400px;
    width: 90%;
  }

  .setup-content h2 {
    margin: 0 0 1rem 0;
    color: #2c3e50;
  }

  .setup-content p {
    margin: 0 0 1.5rem 0;
    color: #6c757d;
  }

  .setup-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-group label {
    font-weight: 500;
    color: #2c3e50;
  }

  .form-group input {
    padding: 0.75rem;
    border: 2px solid #e9ecef;
    border-radius: 6px;
    font-size: 1rem;
    transition: border-color 0.2s ease;
  }

  .form-group input:focus {
    outline: none;
    border-color: #667eea;
  }

  .setup-btn {
    background: #667eea;
    color: white;
    border: none;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  .setup-btn:hover {
    background: #5a6fd8;
  }

  .dashboard-content {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .tab-navigation {
    display: flex;
    background: white;
    border-radius: 12px 12px 0 0;
    overflow: hidden;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .tab-btn {
    flex: 1;
    padding: 1rem;
    border: none;
    background: transparent;
    color: #6c757d;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .tab-btn.active {
    background: #667eea;
    color: white;
  }

  .tab-btn:hover:not(.active) {
    background: #f8f9fa;
  }

  .tab-content {
    background: white;
    border-radius: 0 0 12px 12px;
    padding: 2rem;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .tab-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #f0f0f0;
  }

  .tab-header h2 {
    margin: 0;
    color: #2c3e50;
  }

  .driver-info {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .driver-name {
    font-weight: 500;
    color: #2c3e50;
  }

  .vehicle-id {
    background: #e9ecef;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
  }

  .sync-btn {
    background: #27ae60;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .sync-btn:disabled {
    background: #95a5a6;
    cursor: not-allowed;
  }

  .fleet-container {
    min-height: 400px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .fleet-placeholder {
    text-align: center;
    padding: 2rem;
    background: #f8f9fa;
    border-radius: 8px;
    max-width: 500px;
  }

  .fleet-placeholder h3 {
    color: #2c3e50;
    margin-bottom: 1rem;
  }

  .fleet-placeholder p {
    color: #6c757d;
    margin-bottom: 2rem;
  }

  .fleet-stats {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .stat-item {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem;
    background: white;
    border-radius: 6px;
    border-left: 4px solid #667eea;
  }

  .stat-label {
    font-weight: 500;
    color: #2c3e50;
  }

  .stat-value {
    color: #6c757d;
    font-family: 'Courier New', monospace;
  }

  .network-actions {
    display: flex;
    gap: 1rem;
    margin: 2rem 0;
  }

  .action-btn {
    background: #6c757d;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .action-btn:hover {
    background: #5a6268;
  }

  .network-details, .sync-history {
    background: #f8f9fa;
    padding: 1.5rem;
    border-radius: 8px;
    margin-top: 1rem;
  }

  .network-details h3, .sync-history h3 {
    margin: 0 0 1rem 0;
    color: #2c3e50;
  }

  .diagnostics-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .diagnostic-item {
    display: flex;
    gap: 1rem;
    padding: 0.5rem;
    background: white;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .diagnostic-time {
    color: #6c757d;
    font-family: 'Courier New', monospace;
    min-width: 80px;
  }

  .diagnostic-type {
    color: #667eea;
    font-weight: 500;
    min-width: 80px;
  }

  .diagnostic-message {
    color: #2c3e50;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
</style>
