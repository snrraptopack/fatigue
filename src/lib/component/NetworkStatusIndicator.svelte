<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { networkStatus, connectionStatus, initNetworkMonitoring, manualSync } from '$lib/network';
  import { syncStatus } from '$lib/storage';
  import { browser } from '$app/environment';

  // Props
  export let showDetails = false;
  export let showSyncButton = false;
  export let variant: 'minimal' | 'compact' | 'full' = 'compact';
  export let position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'inline' = 'top-right';
  
  // Local state
  let cleanup: (() => void) | undefined;
  let expanded = false;
  let syncInProgress = false;
  let lastSyncTime: number | null = null;
  let pendingCount = 0;
  let connectionQuality: 'unknown' | 'poor' | 'fair' | 'good' = 'unknown';
  let isOnline = true;
  let latency: number | null = null;
  let syncError: string | null = null;
  let syncProgress = 0;
  
  // Subscribe to network status
  $: {
    isOnline = $networkStatus.online;
    connectionQuality = $networkStatus.connectionQuality;
    latency = $networkStatus.latency;
    syncError = $networkStatus.syncError;
    syncProgress = $networkStatus.syncProgress;
    lastSyncTime = $networkStatus.lastSyncTime;
    syncInProgress = $networkStatus.syncStatus === 'syncing';
  }
  
  // Subscribe to sync status
  $: {
    pendingCount = $syncStatus.pendingCount;
  }
  
  // Get connection status text
  $: connectionStatusText = getConnectionStatusText($connectionStatus);
  
  // Get connection status color
  $: statusColor = getStatusColor($connectionStatus);
  
  // Format time ago
  function formatTimeAgo(timestamp: number | null): string {
    if (!timestamp) return 'Never';
    
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }
  
  // Get connection status text
  function getConnectionStatusText(status: string): string {
    switch (status) {
      case 'offline': return 'Offline';
      case 'reconnecting': return 'Reconnecting...';
      case 'poor': return 'Poor Connection';
      case 'fair': return 'Fair Connection';
      case 'good': return 'Good Connection';
      default: return 'Unknown';
    }
  }
  
  // Get status color
  function getStatusColor(status: string): string {
    switch (status) {
      case 'offline': return 'bg-red-500';
      case 'reconnecting': return 'bg-yellow-500 animate-pulse';
      case 'poor': return 'bg-orange-500';
      case 'fair': return 'bg-yellow-500';
      case 'good': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  }
  
  // Toggle expanded state
  function toggleExpanded() {
    expanded = !expanded;
  }
  
  // Trigger manual sync
  async function triggerSync() {
    if (syncInProgress || !isOnline) return;
    
    try {
      await manualSync();
    } catch (error) {
      console.error('Manual sync failed:', error);
    }
  }
  
  onMount(() => {
    if (browser) {
      // Initialize network monitoring
      cleanup = initNetworkMonitoring();
    }
  });
  
  onDestroy(() => {
    if (cleanup) {
      cleanup();
    }
  });
</script>

<div 
  class="network-status-indicator {variant} {position} {expanded ? 'expanded' : ''}"
  class:inline={position === 'inline'}
>
  <!-- Status Indicator -->
  <div 
    class="status-badge {statusColor}"
    on:click={toggleExpanded}
    on:keydown={(e) => e.key === 'Enter' && toggleExpanded()}
    role="button"
    tabindex="0"
  >
    {#if variant === 'minimal'}
      <!-- Just the dot -->
      <span class="sr-only">{connectionStatusText}</span>
    {:else if variant === 'compact'}
      <!-- Icon + Status -->
      <span class="status-icon">
        {#if $connectionStatus === 'offline'}
          🔴
        {:else if $connectionStatus === 'reconnecting'}
          🟡
        {:else if $connectionStatus === 'poor'}
          🟠
        {:else if $connectionStatus === 'good'}
          🟢
        {:else}
          ⚪
        {/if}
      </span>
      {#if pendingCount > 0}
        <span class="pending-badge">{pendingCount}</span>
      {/if}
    {:else}
      <!-- Full status -->
      <span class="status-text">{connectionStatusText}</span>
      {#if pendingCount > 0}
        <span class="pending-badge">{pendingCount}</span>
      {/if}
    {/if}
  </div>
  
  <!-- Expanded Details -->
  {#if expanded || showDetails}
    <div class="status-details">
      <div class="details-header">
        <h3>Network Status</h3>
        {#if !showDetails}
          <button 
            class="close-button"
            on:click={toggleExpanded}
            aria-label="Close details"
          >
            ✕
          </button>
        {/if}
      </div>
      
      <div class="details-content">
        <div class="detail-row">
          <span class="detail-label">Status:</span>
          <span class="detail-value status-{$connectionStatus}">{connectionStatusText}</span>
        </div>
        
        {#if latency !== null}
          <div class="detail-row">
            <span class="detail-label">Latency:</span>
            <span class="detail-value">{latency}ms</span>
          </div>
        {/if}
        
        <div class="detail-row">
          <span class="detail-label">Pending Items:</span>
          <span class="detail-value">{pendingCount}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Last Sync:</span>
          <span class="detail-value">{formatTimeAgo(lastSyncTime)}</span>
        </div>
        
        {#if syncInProgress}
          <div class="detail-row">
            <span class="detail-label">Sync Progress:</span>
            <div class="progress-bar">
              <div class="progress-fill" style="width: {syncProgress}%"></div>
            </div>
            <span class="progress-text">{syncProgress}%</span>
          </div>
        {/if}
        
        {#if syncError}
          <div class="error-message">
            {syncError}
          </div>
        {/if}
        
        {#if showSyncButton && isOnline && !syncInProgress}
          <button 
            class="sync-button"
            on:click={triggerSync}
            disabled={!isOnline || syncInProgress}
          >
            {syncInProgress ? 'Syncing...' : 'Sync Now'}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .network-status-indicator {
    position: relative;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    z-index: 1000;
  }
  
  .network-status-indicator.inline {
    position: static;
    display: inline-block;
  }
  
  .network-status-indicator.top-right {
    position: fixed;
    top: 1rem;
    right: 1rem;
  }
  
  .network-status-indicator.top-left {
    position: fixed;
    top: 1rem;
    left: 1rem;
  }
  
  .network-status-indicator.bottom-right {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
  }
  
  .network-status-indicator.bottom-left {
    position: fixed;
    bottom: 1rem;
    left: 1rem;
  }
  
  .status-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  }
  
  .minimal .status-badge {
    width: 12px;
    height: 12px;
  }
  
  .compact .status-badge {
    padding: 0.25rem;
    min-width: 2rem;
    height: 2rem;
  }
  
  .full .status-badge {
    padding: 0.5rem 1rem;
    height: 2.5rem;
  }
  
  .status-badge:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }
  
  .status-text {
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
  }
  
  .status-icon {
    font-size: 1.25rem;
    line-height: 1;
  }
  
  .pending-badge {
    position: absolute;
    top: -0.5rem;
    right: -0.5rem;
    background-color: #ef4444;
    color: white;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    min-width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }
  
  .status-details {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background-color: white;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    width: 18rem;
    overflow: hidden;
    z-index: 1001;
  }
  
  .inline .status-details {
    position: static;
    margin-top: 0.5rem;
  }
  
  .details-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background-color: #f3f4f6;
    border-bottom: 1px solid #e5e7eb;
  }
  
  .details-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #1f2937;
  }
  
  .close-button {
    background: none;
    border: none;
    color: #6b7280;
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    width: 1.5rem;
    height: 1.5rem;
  }
  
  .close-button:hover {
    background-color: #e5e7eb;
    color: #1f2937;
  }
  
  .details-content {
    padding: 1rem;
  }
  
  .detail-row {
    display: flex;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
  }
  
  .detail-label {
    font-weight: 500;
    color: #6b7280;
    width: 7rem;
  }
  
  .detail-value {
    font-weight: 600;
    color: #1f2937;
  }
  
  .detail-value.status-offline {
    color: #ef4444;
  }
  
  .detail-value.status-reconnecting {
    color: #f59e0b;
  }
  
  .detail-value.status-poor {
    color: #f97316;
  }
  
  .detail-value.status-fair {
    color: #f59e0b;
  }
  
  .detail-value.status-good {
    color: #10b981;
  }
  
  .progress-bar {
    flex: 1;
    height: 0.5rem;
    background-color: #e5e7eb;
    border-radius: 9999px;
    overflow: hidden;
    margin: 0 0.5rem;
  }
  
  .progress-fill {
    height: 100%;
    background-color: #3b82f6;
    border-radius: 9999px;
    transition: width 0.3s ease;
  }
  
  .progress-text {
    font-size: 0.75rem;
    font-weight: 600;
    color: #6b7280;
    min-width: 2.5rem;
    text-align: right;
  }
  
  .error-message {
    margin-top: 0.5rem;
    padding: 0.5rem;
    background-color: #fee2e2;
    border-radius: 0.25rem;
    color: #b91c1c;
    font-size: 0.75rem;
    line-height: 1.25;
  }
  
  .sync-button {
    margin-top: 0.75rem;
    width: 100%;
    padding: 0.5rem;
    background-color: #3b82f6;
    color: white;
    border: none;
    border-radius: 0.25rem;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }
  
  .sync-button:hover:not(:disabled) {
    background-color: #2563eb;
  }
  
  .sync-button:disabled {
    background-color: #9ca3af;
    cursor: not-allowed;
  }
  
  /* Animation for reconnecting status */
  @keyframes pulse {
    0% { opacity: 0.6; }
    50% { opacity: 1; }
    100% { opacity: 0.6; }
  }
  
  .animate-pulse {
    animation: pulse 1.5s infinite;
  }
</style>