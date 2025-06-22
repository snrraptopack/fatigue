<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  // Change these relative imports to use $lib alias
  import FatigueDetector from '$lib/component/FatigueDetector.svelte';
  import FatigueConfig from '$lib/component/FatigueConfig.svelte';
  import Dashboard from '$lib/component/Dashboard.svelte';
  import AlertList from '$lib/component/AlertList.svelte';
  
  let online = true;
  let syncStatus = 'idle'; // 'idle', 'syncing', 'success', 'error'
  let broadcastChannel:BroadcastChannel;
  
  // Configuration state
  let scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance' = 'workplace_fatigue';
  let driverName = 'Test Driver';
  let vehicleId = 'V001';
  

  onMount(() => {
    if (!browser) return;
    
    online = navigator.onLine;
    
    window.addEventListener('online', () => {
      online = true;
      syncAlerts();
    });
    
    window.addEventListener('offline', () => {
      online = false;
    });
    
    // Set up BroadcastChannel for multi-tab communication
    broadcastChannel = new BroadcastChannel('fatigue-monitor-channel');
    broadcastChannel.onmessage = handleChannelMessage;
    
    // Initial sync if online
    if (online) {
      syncAlerts();
    }
  });
  
  onDestroy(() => {
    if (browser) {
      window.removeEventListener('online', () => { online = true; syncAlerts(); });
      window.removeEventListener('offline', () => { online = false; });
      
      if (broadcastChannel) {
        broadcastChannel.close();
      }
    }
  });
  
  async function syncAlerts() {
    if (!browser || !online) return;
    
    try {
      syncStatus = 'syncing';
      
      // Simulate server sync with a delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      syncStatus = 'success';
      
      // Notify other tabs about successful sync
      if (broadcastChannel) {
        broadcastChannel.postMessage({ 
          type: 'refresh',
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Sync error:', error);
      syncStatus = 'error';
    }
  }
  
  function handleChannelMessage(event:MessageEvent) {
    const { type } = event.data;
    
    if (type === 'refresh') {
      // Reload alerts in this tab
      if (browser) {
        window.dispatchEvent(new CustomEvent('refresh-alerts'));
      }
    }
  }
</script>

<svelte:head>
  <title>Fatigue Monitoring System</title>
</svelte:head>

<div class="container">
  <header>
    <h1>Fatigue Monitoring System</h1>
    <div class="connection-status {online ? 'online' : 'offline'}">
      {online ? 'Online' : 'Offline'} Mode
    </div>
  </header>
  
  <FatigueConfig bind:scenario bind:driverName bind:vehicleId />
  
  <FatigueDetector {scenario} {driverName} {vehicleId} />
  
  <Dashboard />
  
  <AlertList />
  
  <div class="sync-controls">
    <button class="sync-button" on:click={syncAlerts} disabled={!online || syncStatus === 'syncing'}>
      {syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
    </button>
  </div>
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }
  
  h1 {
    margin: 0;
  }
  
  .connection-status {
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-weight: bold;
  }
  
  .online {
    background-color: #4CAF50;
    color: white;
  }
  
  .offline {
    background-color: #F44336;
    color: white;
  }
  
  .sync-controls {
    display: flex;
    justify-content: center;
    margin-top: 2rem;
  }
  
  .sync-button {
    background: #2196F3;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .sync-button:hover:not(:disabled) {
    background: #0b7dda;
  }
  
  .sync-button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
</style>