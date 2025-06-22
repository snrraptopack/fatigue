<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { getAllAlerts } from '$lib/storage';
  import type { FatigueAlert } from '$lib/storage';

  export let driverName: string;
  export let vehicleId: string;

  let alerts: FatigueAlert[] = [];
  let groupedAlerts: Record<string, FatigueAlert[]> = {};
  let expandedGroups: Set<string> = new Set();
  let isLoading = true;

  onMount(async () => {
    if (!browser) return;
    await loadAlerts();
    
    // Listen for new alerts
    window.addEventListener('fatigue-alert', handleNewAlert);
    
    // Refresh alerts every 30 seconds
    const refreshInterval = setInterval(loadAlerts, 30000);
    
    return () => {
      window.removeEventListener('fatigue-alert', handleNewAlert);
      clearInterval(refreshInterval);
    };
  });

  async function loadAlerts() {
    isLoading = true;
    const allAlerts = await getAllAlerts();
    
    // Filter alerts for this driver
    alerts = allAlerts.filter(alert => 
      alert.driverName === driverName && 
      alert.vehicleId === vehicleId
    );
    
    // Group alerts by type
    groupAlerts();
    isLoading = false;
  }

  function handleNewAlert(event: CustomEvent<FatigueAlert>) {
    const alert = event.detail;
    if (alert.driverName === driverName && alert.vehicleId === vehicleId) {
      alerts = [...alerts, alert];
      groupAlerts();
    }
  }

  function groupAlerts() {
    // Group by alert type
    groupedAlerts = {};
    
    alerts.forEach(alert => {
      if (!groupedAlerts[alert.alertType]) {
        groupedAlerts[alert.alertType] = [];
      }
      groupedAlerts[alert.alertType].push(alert);
    });
    
    // Sort alerts within each group by timestamp (newest first)
    Object.keys(groupedAlerts).forEach(type => {
      groupedAlerts[type].sort((a, b) => b.timestamp - a.timestamp);
    });
  }

  function toggleGroup(type: string) {
    if (expandedGroups.has(type)) {
      expandedGroups.delete(type);
    } else {
      expandedGroups.add(type);
    }
    // Force update
    expandedGroups = new Set(expandedGroups);
  }

  function formatAlertType(type: string): string {
    return type.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function getSeverityClass(severity: string): string {
    const classes: Record<string, string> = {
      critical: 'bg-red-100 text-red-800 border-red-200',
      high: 'bg-orange-100 text-orange-800 border-orange-200',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      low: 'bg-green-100 text-green-800 border-green-200'
    };
    return classes[severity] || 'bg-gray-100 text-gray-800 border-gray-200';
  }
</script>

<div class="snapshot-gallery">
  <h2 class="text-xl font-semibold mb-4 text-gray-800">Alert Snapshots</h2>
  
  {#if isLoading}
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
    </div>
  {:else if Object.keys(groupedAlerts).length === 0}
    <div class="text-center py-8 bg-gray-50 rounded-lg">
      <p class="text-gray-500">No alerts captured yet.</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each Object.entries(groupedAlerts) as [type, typeAlerts] (type)}
        <div class="border border-gray-200 rounded-lg overflow-hidden">
          <div 
            class="flex justify-between items-center p-3 bg-gray-100 cursor-pointer"
            on:click={() => toggleGroup(type)}
            on:keydown={(e) => e.key === 'Enter' && toggleGroup(type)}
            role="button"
            tabindex="0"
          >
            <div class="flex items-center gap-2">
              <span class="font-medium">{formatAlertType(type)}</span>
              <span class="bg-gray-200 text-gray-700 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {typeAlerts.length}
              </span>
            </div>
            <svg 
              class="w-5 h-5 transition-transform {expandedGroups.has(type) ? 'rotate-180' : ''}" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
          
          {#if expandedGroups.has(type)}
            <div class="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {#each typeAlerts as alert (alert.id)}
                <div class="border rounded-lg overflow-hidden {getSeverityClass(alert.severity)}">
                  {#if alert.imageDataUrl}
                    <div class="relative">
                      <img 
                        src={alert.imageDataUrl} 
                        alt="Alert snapshot" 
                        class="w-full h-32 object-cover"
                      />
                      <div class="absolute top-1 right-1 bg-black bg-opacity-50 text-white text-xs px-1.5 py-0.5 rounded">
                        {formatTime(alert.timestamp)}
                      </div>
                    </div>
                  {/if}
                  <div class="p-2 text-xs">
                    <div class="flex justify-between items-center">
                      <span class="font-medium">{formatAlertType(alert.alertType)}</span>
                      <span class="uppercase font-bold">{alert.severity}</span>
                    </div>
                    <div class="mt-1 text-gray-600">
                      {#if alert.duration}
                        <div>Duration: {(alert.duration / 1000).toFixed(1)}s</div>
                      {/if}
                      {#if alert.confidence}
                        <div>Confidence: {Math.round(alert.confidence * 100)}%</div>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .snapshot-gallery {
    margin-top: 1.5rem;
  }
</style>