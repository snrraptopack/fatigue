<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import type { FatigueAlert } from '$lib/storage';

  export let driverId: string;
  export let alerts: FatigueAlert[] = [];
  
  let groupedAlerts: Record<string, FatigueAlert[]> = {};
  let expandedGroups: Set<string> = new Set();
  let selectedSnapshot: FatigueAlert | null = null;
  
  $: {
    // Group alerts by type whenever alerts change
    groupAlerts(alerts);
  }
  
  function groupAlerts(alertsToGroup: FatigueAlert[]) {
    // Filter alerts for this driver
    const driverAlerts = alertsToGroup.filter(alert => 
      `${alert.driverName.toLowerCase().replace(' ', '-')}-${alert.vehicleId.toLowerCase()}` === driverId
    );
    
    // Group by alert type
    groupedAlerts = {};
    
    driverAlerts.forEach(alert => {
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
  
  function viewSnapshot(alert: FatigueAlert) {
    selectedSnapshot = alert;
  }
  
  function closeSnapshot() {
    selectedSnapshot = null;
  }

  function formatAlertType(type: string): string {
    return type.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
  
  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
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
  
  function getSeverityBadgeClass(severity: string): string {
    const classes: Record<string, string> = {
      critical: 'bg-red-500/20 text-red-400',
      high: 'bg-orange-400/20 text-orange-300',
      medium: 'bg-yellow-400/20 text-yellow-300',
      low: 'bg-green-500/20 text-green-400'
    };
    return classes[severity] || 'bg-gray-500/20 text-gray-400';
  }
</script>

<div class="admin-snapshot-gallery">
  <h3 class="text-xl font-bold text-white mb-4">📸 Alert Snapshots</h3>
  
  {#if Object.keys(groupedAlerts).length === 0}
    <div class="text-center py-8 bg-gray-800 rounded-lg border border-gray-700">
      <p class="text-gray-400">No snapshots available for this driver.</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each Object.entries(groupedAlerts) as [type, typeAlerts] (type)}
        <div class="border border-gray-700 rounded-lg overflow-hidden bg-gray-800">
          <div 
            class="flex justify-between items-center p-3 bg-gray-700 cursor-pointer"
            on:click={() => toggleGroup(type)}
            on:keydown={(e) => e.key === 'Enter' && toggleGroup(type)}
            role="button"
            tabindex="0"
          >
            <div class="flex items-center gap-2">
              <span class="font-medium text-white">{formatAlertType(type)}</span>
              <span class="bg-gray-600 text-gray-300 text-xs font-medium px-2.5 py-0.5 rounded-full">
                {typeAlerts.length}
              </span>
            </div>
            <svg 
              class="w-5 h-5 transition-transform text-gray-300 {expandedGroups.has(type) ? 'rotate-180' : ''}" 
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
                <div 
                  class="border rounded-lg overflow-hidden bg-gray-700 border-gray-600 cursor-pointer hover:border-purple-500 transition-colors"
                  on:click={() => viewSnapshot(alert)}
                  on:keydown={(e) => e.key === 'Enter' && viewSnapshot(alert)}
                  role="button"
                  tabindex="0"
                >
                  {#if alert.imageDataUrl}
                    <div class="relative">
                      <img 
                        src={alert.imageDataUrl} 
                        alt="Alert snapshot" 
                        class="w-full h-32 object-cover"
                      />
                      <div class="absolute top-1 right-1 bg-black bg-opacity-70 text-white text-xs px-1.5 py-0.5 rounded">
                        {formatTime(alert.timestamp)}
                      </div>
                      <div class="absolute bottom-1 left-1">
                        <span class="text-xs font-semibold uppercase px-2 py-1 rounded-full {getSeverityBadgeClass(alert.severity)}">
                          {alert.severity}
                        </span>
                      </div>
                    </div>
                  {:else}
                    <div class="h-32 flex items-center justify-center bg-gray-800">
                      <span class="text-gray-400">No image available</span>
                    </div>
                  {/if}
                  <div class="p-2 text-xs text-gray-300">
                    <div class="font-medium text-white">{formatAlertType(alert.alertType)}</div>
                    <div class="mt-1 flex justify-between">
                      <span>{formatDate(alert.timestamp)}</span>
                      {#if alert.duration}
                        <span>{(alert.duration / 1000).toFixed(1)}s</span>
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
  
  <!-- Modal for viewing a snapshot in detail -->
  {#if selectedSnapshot}
    <div 
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75" 
      on:click={closeSnapshot}
      on:keydown={(e) => e.key === 'Escape' && closeSnapshot()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-modal-title"
      tabindex="-1"
    >
      <div 
        class="bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full mx-4 overflow-hidden" 
        role="document"
      >
        <div class="p-4 border-b border-gray-700 flex justify-between items-center">
          <h3 id="snapshot-modal-title" class="text-xl font-bold text-white">
            {formatAlertType(selectedSnapshot.alertType)} Alert
          </h3>
          <button 
            class="text-gray-400 hover:text-white"
            on:click={closeSnapshot}
            aria-label="Close modal"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
        
        <div class="p-4">
          {#if selectedSnapshot.imageDataUrl}
            <div class="mb-4">
              <img 
                src={selectedSnapshot.imageDataUrl} 
                alt="Alert snapshot" 
                class="w-full max-h-96 object-contain rounded"
              />
            </div>
          {/if}
          
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p class="text-gray-400">Severity</p>
              <p class="text-white font-medium">
                <span class="inline-block px-2 py-1 rounded-full text-xs {getSeverityBadgeClass(selectedSnapshot.severity)}">
                  {selectedSnapshot.severity.toUpperCase()}
                </span>
              </p>
            </div>
            
            <div>
              <p class="text-gray-400">Time</p>
              <p class="text-white font-medium">
                {formatTime(selectedSnapshot.timestamp)}
              </p>
            </div>
            
            <div>
              <p class="text-gray-400">Date</p>
              <p class="text-white font-medium">
                {formatDate(selectedSnapshot.timestamp)}
              </p>
            </div>
            
            <div>
              <p class="text-gray-400">Scenario</p>
              <p class="text-white font-medium">
                {selectedSnapshot.scenario.replace(/_/g, ' ')}
              </p>
            </div>
            
            {#if selectedSnapshot.duration}
              <div>
                <p class="text-gray-400">Duration</p>
                <p class="text-white font-medium">
                  {(selectedSnapshot.duration / 1000).toFixed(1)} seconds
                </p>
              </div>
            {/if}
            
            {#if selectedSnapshot.confidence}
              <div>
                <p class="text-gray-400">Confidence</p>
                <p class="text-white font-medium">
                  {Math.round(selectedSnapshot.confidence * 100)}%
                </p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-snapshot-gallery {
    margin-top: 1rem;
  }
</style>