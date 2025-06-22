<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { getAllAlerts } from '$lib/storage';
  import type { FatigueAlert } from '$lib/storage';
  
  let alerts: FatigueAlert[] = [];
  let refreshInterval: number;
  
  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
  
  async function loadAlerts(): Promise<void> {
    if (!browser) return;
    alerts = await getAllAlerts();
    alerts.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  function handleFatigueAlert(): void {
    loadAlerts();
  }
  
  function handleRefreshEvent(){
    loadAlerts()
  }
  onMount(async () => {
    if (!browser) return;
    
    await loadAlerts();
    
   // Listen for new alerts from FatigueDetector
    window.addEventListener('fatigue-alert', handleFatigueAlert);
    
    // Listen for refresh events from other tabs
    window.addEventListener('refresh-alerts', handleRefreshEvent);
    
    // Refresh alerts periodically
    refreshInterval = window.setInterval(loadAlerts, 5000);
  });
  
   onDestroy(() => {
    if (browser) {
      window.removeEventListener('fatigue-alert', handleFatigueAlert);
      window.removeEventListener('refresh-alerts', handleRefreshEvent);
      if (refreshInterval) {
        window.clearInterval(refreshInterval);
      }
    }
  });
</script>

<div class="alert-list">
  <h2>Fatigue Alerts</h2>
  
  {#if alerts.length === 0}
    <p class="no-alerts">No alerts detected</p>
  {:else}
    <div class="alerts-container">
      {#each alerts as alert}
        <div class="alert-card {alert.severity}">
          <div class="alert-header">
            <span class="alert-type">{alert.alertType}</span>
            <span class="alert-time">{formatDate(alert.timestamp)}</span>
          </div>
          <div class="alert-body">
            <div class="alert-info">
              <p><strong>Driver:</strong> {alert.driverName}</p>
              <p><strong>Vehicle:</strong> {alert.vehicleId}</p>
              <p><strong>Severity:</strong> {alert.severity}</p>
              <p><strong>Status:</strong> {alert.synced ? 'Synced' : 'Local only'}</p>
            </div>
            {#if alert.imageDataUrl}
              <div class="alert-image">
                <img src={alert.imageDataUrl} alt="Alert Screenshot" />
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Styles remain unchanged */
</style>