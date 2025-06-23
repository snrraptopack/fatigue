<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { writable } from 'svelte/store';
  import type { FatigueAlert } from '$lib/storage';
  import AdminSnapshotGallery from '$lib/component/AdminSnapshotGallery.svelte';
  import { setActiveWebSocketConnection } from '$lib/network';

  // Real-time stores
  const liveAlerts = writable<FatigueAlert[]>([]);
  const driverStatuses = writable<Record<string, any>>({});
  const liveFrames = writable<Record<string, {frame: string, timestamp: number}>>({});

  let alerts: FatigueAlert[] = [];
  let drivers: Record<string, any> = {};
  let selectedAlert: FatigueAlert | null = null;
  let selectedDriver: string | null = null;
  let filterSeverity: string = 'all';
  let filterScenario: string = 'all';
  let filterDriverName: string = '';
  let sortBy: 'timestamp' | 'severity' | 'driver' = 'timestamp';
  let isConnected = false;
  let alertEventSource: EventSource | null = null;
  let frameEventSource: EventSource | null = null;
  let wsConnection: WebSocket | null = null;
  let wsConnected = false;
  let currentVideoFrame: { driverId: string, frame: string, timestamp: number } | null = null;
  let streamRequested = false;
  let isRecording = false;

  // Auto-refresh and connection management
  let refreshInterval: number|undefined;
  let connectionCheckInterval: number|undefined;
  let pingInterval: number|undefined ;
  let reconnectTimeout: number|undefined;
  let reconnectAttempts:number|undefined = 0;

  // Scenario options
  const scenarioOptions = [
    { value: 'workplace_fatigue', label: 'Workplace Fatigue' },
    { value: 'driving_distraction', label: 'Driving Distraction' },
    { value: 'attention_monitoring', label: 'Attention Monitoring' },
    { value: 'safety_compliance', label: 'Safety Compliance' }
  ];

  onMount(() => {
    if (!browser) return;

    initializeRealTimeConnection();
    initializeWebSocket();
    loadAlertsAndDrivers();

    refreshInterval = window.setInterval(loadAlertsAndDrivers, 10000); // Refresh every 10 seconds
    connectionCheckInterval = window.setInterval(checkConnection, 5000);
  });

  // Function to start ping interval
  function startPingInterval() {
    // Clear any existing interval
    stopPingInterval();

    // Send ping every 15 seconds to keep connection alive
    pingInterval = window.setInterval(() => {
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        try {
          wsConnection.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (error) {
          console.error('Failed to send ping:', error);
        }
      }
    }, 15000);
  }

  // Function to stop ping interval
  function stopPingInterval() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = undefined;
    }
  }

  onDestroy(() => {
    if (browser) {
      // Close SSE connections
      if (alertEventSource) {
        alertEventSource.close();
        alertEventSource = null;
      }
      if (frameEventSource) {
        frameEventSource.close();
        frameEventSource = null;
      }

      // Close WebSocket connection
      if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
      }

      // Clear intervals and timeouts
      if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = undefined;
      }
      if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = undefined;
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = undefined;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }

      // Reset state
      isConnected = false;
      wsConnected = false;
      streamRequested = false;
      isRecording = false;
    }
  });

  async function initializeRealTimeConnection() {
    try {
      // Initialize alerts SSE connection
      alertEventSource = new EventSource('/api/admin/live-alerts');

      alertEventSource.onopen = () => {
        isConnected = true;
        console.log('Alerts SSE connection established');
      };

      alertEventSource.onmessage = (event) => {
        const eventData = JSON.parse(event.data);
        if (eventData.type === 'alert' && eventData.data) {
          handleNewAlert(eventData.data);
        } else if (eventData.type === 'heartbeat') {
          console.log('Alerts heartbeat received');
        }
      };

      alertEventSource.onerror = () => {
        isConnected = false;
        console.log('Alerts SSE connection lost, attempting to reconnect...');
      };

      // Initialize frames SSE connection
      initializeFramesConnection();

    } catch (error) {
      console.error('Failed to establish SSE connections:', error);
      isConnected = false;
    }
  }

  function initializeFramesConnection(driverId?: string) {
    try {
      // Close existing connection if any
      if (frameEventSource) {
        frameEventSource.close();
      }

      // Create URL with optional driverId parameter
      const url = driverId 
        ? `/api/admin/live-frames?driverId=${encodeURIComponent(driverId)}`
        : '/api/admin/live-frames';

      frameEventSource = new EventSource(url);

      frameEventSource.onopen = () => {
        console.log('Frames SSE connection established');
      };

      frameEventSource.onmessage = (event) => {
        const eventData = JSON.parse(event.data);
        if (eventData.type === 'frame' && eventData.data) {
          handleNewFrame(eventData.data);
        } else if (eventData.type === 'heartbeat') {
          console.log('Frames heartbeat received');
        }
      };

      frameEventSource.onerror = () => {
        console.log('Frames SSE connection lost, attempting to reconnect...');
        // Try to reconnect after a short delay
        setTimeout(() => {
          if (browser) {
            initializeFramesConnection(driverId);
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to establish frames SSE connection:', error);
    }
  }

  function handleNewFrame(frameData: { driverId: string, frame: string, timestamp: number }) {
    // Update the liveFrames store with the new frame
    liveFrames.update(frames => {
      return {
        ...frames,
        [frameData.driverId]: {
          frame: frameData.frame,
          timestamp: frameData.timestamp
        }
      };
    });

    // If this is the selected driver, update currentVideoFrame
    if (selectedDriver === frameData.driverId) {
      currentVideoFrame = frameData;

      // Update the UI if element exists
      if (browser) {
        const imgElement = document.getElementById('driver-stream') as HTMLImageElement;
        if (imgElement) {
          imgElement.src = frameData.frame;
        }
      }
    }
  }

  function initializeWebSocket() {
    if (!browser) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;

      // Close existing connection if any
      if (wsConnection && wsConnection.readyState !== WebSocket.CLOSED) {
        wsConnection.close();
      }

      // Create a new WebSocket connection
      wsConnection = new WebSocket(wsUrl);

      wsConnection.onopen = () => {
        wsConnected = true;
        console.log('WebSocket connection established');

        // Send a message to identify as admin
        wsConnection?.send(JSON.stringify({
          type: 'identify',
          role: 'admin'
        }));
        console.log('Sent identify message to server');

        // Start ping interval to keep connection alive
        startPingInterval();

        // Register the connection with the network module
        setActiveWebSocketConnection(wsConnection);
      };

      wsConnection.onclose = (event) => {
        wsConnected = false;
        console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);

        // Stop ping interval
        stopPingInterval();

        // Update the network module
        setActiveWebSocketConnection(null);

        
        const delay = Math.min(30000, 1000 * Math.pow(1.5, reconnectAttempts));
        reconnectAttempts++;
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
        reconnectTimeout = setTimeout(initializeWebSocket, delay);
      };

      wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsConnected = false;
      };

      wsConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received WebSocket message:', data.type);

          // Reset reconnect attempts on successful message
          if (data.type !== 'pong') {
            reconnectAttempts = 0;
          }

          switch (data.type) {
            case 'drivers':
              // Update driver list
              if (data.drivers) {
                const driverMap: Record<string, any> = {};
                data.drivers.forEach((driver: any) => {
                  driverMap[driver.driverId] = driver;
                });
                drivers = driverMap;
                driverStatuses.set(drivers);

                // Log the number of drivers
                console.log(`Received ${data.drivers.length} drivers from server`);
              }
              break;

            case 'video_frame':
              // Update video frame
              if (data.driverId && data.frame) {
                currentVideoFrame = {
                  driverId: data.driverId,
                  frame: data.frame,
                  timestamp: data.timestamp
                };

                // If this is the selected driver, update the UI
                if (selectedDriver === data.driverId) {
                  const imgElement = document.getElementById('driver-stream') as HTMLImageElement;
                  if (imgElement) {
                    imgElement.src = data.frame;
                  }
                }
              }
              break;

            case 'alert':
              // Handle new alert
              if (data.data) {
                handleNewAlert(data.data);
              }
              break;

            case 'pong':
              // Received pong from server, connection is alive
              console.log('Received pong from server');
              break;

            case 'error':
              // Handle error messages from server
              console.error('Server error:', data.message);
              break;
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      wsConnected = false;
    }
  }

  function requestDriverStream(driverId: string, active: boolean) {
    if (!wsConnection || wsConnection.readyState !== 1) { // 1 = OPEN in WebSocket standard
      console.error('WebSocket not connected');
      return;
    }

    wsConnection.send(JSON.stringify({
      type: 'stream_request',
      driverId,
      active
    }));

    streamRequested = active;

    // If we're turning off streaming, clear the current frame
    if (!active) {
      currentVideoFrame = null;

      // Also stop recording if it's active
      if (isRecording) {
        toggleRecording(driverId, false);
      }
    } else {
      // Request the latest frame if available
      wsConnection.send(JSON.stringify({
        type: 'get_frame',
        driverId
      }));

      // Initialize frames connection for this specific driver
      initializeFramesConnection(driverId);
    }
  }

  function toggleRecording(driverId: string, active: boolean) {
    isRecording = active;

    if (active) {
      console.log(`Starting recording for driver ${driverId}`);
      // We're already receiving frames via SSE, just need to store them
      // This is handled by the handleNewFrame function
    } else {
      console.log(`Stopping recording for driver ${driverId}`);
    }

    // Notify the server about recording status change
    if (wsConnection && wsConnection.readyState === 1) { // 1 = OPEN in WebSocket standard
      wsConnection.send(JSON.stringify({
        type: 'recording_status',
        driverId,
        active
      }));
    }
  }

  function changeDriverScenario(driverId: string, scenario: string) {
    if (!wsConnection || wsConnection.readyState !== 1) { // 1 = OPEN in WebSocket standard
      console.error('WebSocket not connected');
      return;
    }

    wsConnection.send(JSON.stringify({
      type: 'scenario_change',
      driverId,
      scenario
    }));
  }

  function selectDriver(driverId: string) {
    // If selecting the same driver, toggle selection
    if (selectedDriver === driverId) {
      selectedDriver = null;
      if (streamRequested) {
        requestDriverStream(driverId, false);
      }
    } else {
      // If a different driver was previously selected, stop streaming
      if (selectedDriver && streamRequested) {
        requestDriverStream(selectedDriver, false);
      }

      selectedDriver = driverId;

      // Request the latest frame if available
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify({
          type: 'get_frame',
          driverId
        }));
      }
    }
  }

  async function loadAlertsAndDrivers() {
    try {
      const alertsResponse = await fetch('/api/admin/alerts');
      if (alertsResponse.ok) {
        const data = await alertsResponse.json();
        // Extract the alerts array from the response
        alerts = data.alerts || [];
        liveAlerts.set(alerts);
      }

      const driversResponse = await fetch('/api/admin/drivers');
      if (driversResponse.ok) {
        drivers = await driversResponse.json();
        driverStatuses.set(drivers);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      loadOfflineData();
    }
  }

  async function clearAllData(clearMongoDB = false) {
    if (!confirm('Are you sure you want to clear all alerts and driver data? This cannot be undone.')) {
      return;
    }

    try {
      const url = clearMongoDB 
        ? '/api/admin/alerts?all=true' 
        : '/api/admin/alerts';

      const response = await fetch(url, {
        method: 'DELETE'
      });

      if (response.ok) {
        alerts = [];
        liveAlerts.set(alerts);

        if (clearMongoDB) {
          drivers = {};
          driverStatuses.set(drivers);
        }

        // Reload data after clearing
        await loadAlertsAndDrivers();
      } else {
        console.error('Failed to clear data:', await response.text());
      }
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  }

  function loadOfflineData() {
    if (!browser) return;
    try {
      const offlineAlerts = localStorage.getItem('admin-alerts');
      if (offlineAlerts) {
        alerts = JSON.parse(offlineAlerts);
        liveAlerts.set(alerts);
      }
      const offlineDrivers = localStorage.getItem('admin-drivers');
      if (offlineDrivers) {
        drivers = JSON.parse(offlineDrivers);
        driverStatuses.set(drivers);
      }
    } catch (error) {
      console.error('Failed to load offline data:', error);
    }
  }

  function handleNewAlert(alert: FatigueAlert) {
    alerts = [alert, ...alerts];
    liveAlerts.set(alerts);

    const driverId = `${alert.driverName}-${alert.vehicleId}`;
    drivers[driverId] = {
      ...(drivers[driverId] || { name: alert.driverName, vehicleId: alert.vehicleId }),
      status: alert.severity === 'critical' ? 'critical' : 'alert',
      lastSeen: alert.timestamp,
      alertCount: (drivers[driverId]?.alertCount || 0) + 1
    };
    driverStatuses.set(drivers);

    if (alert.severity === 'critical') {
      playAlertSound();
    }

    if (browser) {
      localStorage.setItem('admin-alerts', JSON.stringify(alerts));
      localStorage.setItem('admin-drivers', JSON.stringify(drivers));
    }
  }

  function playAlertSound() {
    if (browser) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.5);
    }
  }

  function checkConnection() {
    fetch('/api/admin/ping')
      .then((res) => isConnected = res.ok)
      .catch(() => isConnected = false);
  }

  function getSeverityClass(severity: string): string {
    const classes: Record<string, string> = {
      critical: 'border-red-500',
      high: 'border-orange-400',
      medium: 'border-yellow-400',
      low: 'border-green-500'
    };
    return classes[severity] || 'border-gray-500';
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

  function formatTimeAgo(timestamp: number): string {
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

  function getFilteredDrivers() {
    const driverList = Object.values(drivers);
    if (filterDriverName.trim() === '') {
      return driverList;
    }
    return driverList.filter(driver => 
      driver.name.toLowerCase().includes(filterDriverName.toLowerCase())
    );
  }

  function getFilteredAlerts() {
    let filtered = alerts;

    if (filterSeverity !== 'all') {
      filtered = filtered.filter(alert => alert.severity === filterSeverity);
    }

    if (filterScenario !== 'all') {
      filtered = filtered.filter(alert => alert.scenario === filterScenario);
    }

    if (filterDriverName.trim() !== '') {
      filtered = filtered.filter(alert => alert.driverName.toLowerCase().includes(filterDriverName.toLowerCase()));
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'severity':
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
        case 'driver':
          return a.driverName.localeCompare(b.driverName);
        default:
          return b.timestamp - a.timestamp;
      }
    });

    return filtered;
  }

  async function acknowledgeAlert(alertId: string) {
    try {
      const response = await fetch(`/api/admin/alerts/${alertId}/acknowledge`, {
        method: 'POST'
      });

      if (response.ok) {
        alerts = alerts.map(alert => 
          alert.id === alertId 
            ? { ...alert, acknowledged: true }
            : alert
        );
        liveAlerts.set(alerts);
      }
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  }

  function openAlertDetails(alert: FatigueAlert) {
    selectedAlert = alert;
  }

  function closeAlertDetails() {
    selectedAlert = null;
  }
</script>

<div class="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8 font-sans">
  <!-- Header -->
  <header class="bg-gray-800/50 backdrop-blur-lg rounded-2xl p-6 sm:p-8 mb-8 shadow-lg border border-gray-700">
    <div class="flex justify-between items-center flex-wrap gap-4">
      <div>
        <h1 class="text-3xl sm:text-4xl font-bold text-white">🚨 Admin Control Center</h1>
        <div class="flex items-center gap-2 mt-2">
          <div class="w-3 h-3 rounded-full animate-pulse {isConnected ? 'bg-green-400' : 'bg-red-500'}"></div>
          <span class="font-medium text-gray-300">{isConnected ? 'Live Connection' : 'Offline Mode'}</span>
        </div>
      </div>

      <div class="flex gap-3 sm:gap-4">
        <div class="flex flex-col items-center p-4 rounded-xl min-w-[90px] text-white font-semibold shadow-md bg-gradient-to-br from-red-500 to-red-700">
          <span class="text-3xl font-bold">{alerts.filter((a) => a.severity === 'critical' && !a.acknowledged).length}</span>
          <span class="text-sm opacity-90">Critical</span>
        </div>
        <div class="flex flex-col items-center p-4 rounded-xl min-w-[90px] text-white font-semibold shadow-md bg-gradient-to-br from-orange-500 to-orange-600">
          <span class="text-3xl font-bold">{alerts.filter((a) => a.severity === 'high' && !a.acknowledged).length}</span>
          <span class="text-sm opacity-90">High</span>
        </div>
        <div class="flex flex-col items-center p-4 rounded-xl min-w-[90px] text-white font-semibold shadow-md bg-gradient-to-br from-sky-500 to-sky-600">
          <span class="text-3xl font-bold">{Object.keys(drivers).length}</span>
          <span class="text-sm opacity-90">Active Drivers</span>
        </div>
      </div>
    </div>
  </header>

  <!-- Filters and Controls -->
  <div class="bg-gray-800/50 rounded-xl p-4 mb-8 flex justify-between items-center gap-4 flex-wrap border border-gray-700">
    <div class="flex gap-4 flex-wrap">
      <select bind:value={filterSeverity} class="bg-gray-700 border-gray-600 rounded-lg px-4 py-2 font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition">
        <option value="all">All Severities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      <select bind:value={filterScenario} class="bg-gray-700 border-gray-600 rounded-lg px-4 py-2 font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition">
        <option value="all">All Scenarios</option>
        <option value="workplace_fatigue">Workplace Fatigue</option>
        <option value="driving_distraction">Driving Distraction</option>
        <option value="attention_monitoring">Attention Monitoring</option>
        <option value="safety_compliance">Safety Compliance</option>
      </select>

      <select bind:value={sortBy} class="bg-gray-700 border-gray-600 rounded-lg px-4 py-2 font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition">
        <option value="timestamp">Sort by Time</option>
        <option value="severity">Sort by Severity</option>
        <option value="driver">Sort by Driver</option>
      </select>

      <input type="text" placeholder="Filter by driver name..." bind:value={filterDriverName} class="bg-gray-700 border-gray-600 rounded-lg px-4 py-2 font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition" />
    </div>

    <div class="flex gap-2">
      <div class="relative group">
        <button class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors" on:click={() => clearAllData(false)}>
          🗑️ Clear Cache
        </button>
        <div class="absolute hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded shadow-lg w-48 top-full right-0 mt-1 z-10">
          Clears in-memory cache only. Use this if you see stale data.
        </div>
      </div>

      <div class="relative group">
        <button class="bg-red-800 hover:bg-red-900 text-white font-bold py-2 px-4 rounded-lg transition-colors" on:click={() => clearAllData(true)}>
          💣 Clear All Data
        </button>
        <div class="absolute hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded shadow-lg w-48 top-full right-0 mt-1 z-10">
          Deletes all data from MongoDB and clears cache. Use with caution!
        </div>
      </div>

      <button class="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition-colors" on:click={loadAlertsAndDrivers}>
        🔄 Refresh
      </button>
    </div>
  </div>

  <!-- Main Content Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
    <!-- Driver Status Column -->
    <div class="lg:col-span-1">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-2xl font-bold text-gray-200">🚛 Driver Status</h2>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full {wsConnected ? 'bg-green-400' : 'bg-red-500'}"></div>
          <span class="text-sm font-medium text-gray-400">{wsConnected ? 'WS Connected' : 'WS Disconnected'}</span>
        </div>
      </div>

      <div class="space-y-4">
        {#each Object.entries(drivers) as [driverId, driver] (driverId)}
          <div 
            class="bg-gray-800 rounded-lg p-4 shadow-md border-l-4 cursor-pointer transition-all hover:bg-gray-700/80 
                  {driver.status === 'critical' ? 'border-red-500' : 
                   driver.status === 'alert' ? 'border-orange-400' : 
                   driver.status === 'active' ? 'border-green-500' : 'border-gray-500'}
                  {selectedDriver === driverId ? 'ring-2 ring-purple-500' : ''}"
            on:click={() => selectDriver(driverId)}
            on:keydown={(e) => e.key === 'Enter' && selectDriver(driverId)}
            role="button"
            tabindex="0"
          >
            <div class="flex justify-between items-start">
              <div>
                <h3 class="font-bold text-lg text-white">{driver.name}</h3>
                <p class="text-sm text-gray-400">{driver.vehicleId}</p>
              </div>
              <div class="text-right flex flex-col items-end gap-2">
                <span class="text-sm font-semibold uppercase px-2 py-1 rounded-full 
                      {driver.status === 'critical' ? 'bg-red-500/20 text-red-400' : 
                       driver.status === 'alert' ? 'bg-orange-400/20 text-orange-300' : 
                       driver.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}">
                  {driver.status}
                </span>
                <div class="flex flex-col gap-1">
                  {#if driver.isStreaming}
                    <span class="text-xs font-medium px-2 py-1 rounded-full bg-purple-500/20 text-purple-300">
                      Streaming
                    </span>
                  {/if}
                  {#if driver.isRecording}
                    <span class="text-xs font-medium px-2 py-1 rounded-full bg-red-500/20 text-red-300 animate-pulse">
                      Recording
                    </span>
                  {/if}
                </div>
              </div>
            </div>
            <div class="flex justify-between items-center mt-4 text-sm">
              <div class="text-gray-300">
                <span class="font-bold text-white">{driver.alertCount || 0}</span> Alerts
              </div>
              <div class="text-gray-400">{formatTimeAgo(driver.lastSeen)}</div>
            </div>

            {#if selectedDriver === driverId}
              <div class="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-2">
                <button 
                  class="text-sm font-medium py-2 px-3 rounded-lg transition-colors
                        {streamRequested ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}"
                  on:click|stopPropagation={() => requestDriverStream(driverId, !streamRequested)}
                >
                  {streamRequested ? '⏹️ Stop Stream' : '▶️ Start Stream'}
                </button>

                <select 
                  class="bg-gray-700 border-gray-600 rounded-lg px-2 py-2 text-sm font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
                  on:change|stopPropagation={(e) => changeDriverScenario(driverId, e.target.value)}
                  value={driver.scenario || 'workplace_fatigue'}
                >
                  {#each scenarioOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>
        {/each}

        {#if Object.keys(drivers).length === 0}
          <div class="text-center py-8 px-4 bg-gray-800 rounded-lg">
            <div class="text-4xl mb-3">🚗</div>
            <h3 class="text-lg font-semibold text-white">No Drivers Connected</h3>
            <p class="text-gray-400 text-sm mt-1">Waiting for driver connections...</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Main Content Column -->
    <div class="lg:col-span-2">
      {#if selectedDriver && drivers[selectedDriver]}
        <!-- Driver Monitoring Panel -->
        <div class="bg-gray-800 rounded-lg p-6 shadow-md mb-8 border border-gray-700">
          <div class="flex justify-between items-center mb-4">
            <h2 class="text-2xl font-bold text-white">
              👁️ Monitoring: {drivers[selectedDriver].name}
            </h2>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300">
                {drivers[selectedDriver].scenario?.replace(/_/g, ' ') || 'workplace fatigue'}
              </span>
              <div class="flex items-center gap-2">
                {#if streamRequested}
                  <span class="text-sm font-medium px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 animate-pulse">
                    Live Stream
                  </span>
                {/if}
                {#if isRecording}
                  <span class="text-sm font-medium px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 animate-pulse">
                    Recording
                  </span>
                {/if}
              </div>
            </div>
          </div>

          <div class="relative bg-black rounded-lg overflow-hidden aspect-video flex items-center justify-center">
            {#if currentVideoFrame && currentVideoFrame.driverId === selectedDriver}
              <img 
                id="driver-stream" 
                src={currentVideoFrame.frame} 
                alt="Driver stream" 
                class="max-w-full max-h-full object-contain"
              />
              <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                Last update: {formatTimeAgo(currentVideoFrame.timestamp)}
              </div>
            {:else if streamRequested}
              <div class="text-center text-gray-400">
                <div class="animate-spin w-8 h-8 border-4 border-gray-600 border-t-purple-500 rounded-full mb-2 mx-auto"></div>
                <p>Waiting for video stream...</p>
              </div>
            {:else}
              <div class="text-center text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-2 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p>Click "Start Stream" to begin monitoring</p>
              </div>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-4 mt-4">
            <button 
              class="text-white font-medium py-2 px-4 rounded-lg transition-colors
                    {streamRequested ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}"
              on:click={() => requestDriverStream(selectedDriver, !streamRequested)}
            >
              {streamRequested ? '⏹️ Stop Stream' : '▶️ Start Stream'}
            </button>

            <select 
              class="bg-gray-700 border-gray-600 rounded-lg px-4 py-2 font-medium focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
              on:change={(e) => changeDriverScenario(selectedDriver, e.target.value)}
              value={drivers[selectedDriver].scenario || 'workplace_fatigue'}
            >
              {#each scenarioOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>

            {#if streamRequested}
              <button 
                class="text-white font-medium py-2 px-4 rounded-lg transition-colors col-span-2
                      {isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}"
                on:click={() => toggleRecording(selectedDriver, !isRecording)}
              >
                {isRecording ? '⏹️ Stop Recording' : '🔴 Start Recording'}
              </button>
            {/if}
          </div>

          <!-- Driver Snapshots -->
          <AdminSnapshotGallery 
            driverId={selectedDriver}
            alerts={alerts}
          />
        </div>
      {/if}

      <!-- Alerts Feed -->
      <h2 class="text-2xl font-bold mb-4 text-gray-200">🚨 Live Alert Feed</h2>
      <div class="space-y-4">
        {#each getFilteredAlerts() as alert (alert.id)}
          <div class="bg-gray-800 rounded-lg p-4 shadow-md cursor-pointer transition-all hover:bg-gray-700/80 border-l-4 {getSeverityClass(alert.severity)} {alert.acknowledged ? 'opacity-50' : ''}"
               on:click={() => openAlertDetails(alert)}
               on:keydown={(e) => e.key === 'Enter' && openAlertDetails(alert)}
               role="button"
               tabindex="0">

            <div class="flex justify-between items-center mb-2 flex-wrap gap-2">
              <div class="flex items-center gap-3">
                <span class="font-bold text-sm uppercase px-3 py-1 rounded-full {getSeverityBadgeClass(alert.severity)}">{alert.severity}</span>
                <span class="font-semibold text-gray-300 capitalize">{alert.alertType.replace(/([A-Z])/g, ' $1').trim()}</span>
              </div>
              <span class="text-sm text-gray-400">{formatTimeAgo(alert.timestamp)}</span>
            </div>

            <div class="flex justify-between items-end mt-2">
              <div>
                <h4 class="font-semibold text-white">👤 {alert.driverName}</h4>
                <p class="text-gray-400 text-sm">🚛 {alert.vehicleId}</p>
              </div>

              <div class="flex items-center gap-2">
                {#if !alert.acknowledged}
                  <button class="bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-1 px-3 rounded-lg transition-colors" 
                          on:click|stopPropagation={() => acknowledgeAlert(alert.id)}>
                    ✓ Acknowledge
                  </button>
                {/if}
                <button class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1 px-3 rounded-lg transition-colors">
                  👁️ Details
                </button>
              </div>
            </div>
          </div>
        {/each}

        {#if getFilteredAlerts().length === 0}
          <div class="text-center py-16 px-4 bg-gray-800 rounded-lg">
            <div class="text-5xl mb-4">✅</div>
            <h3 class="text-xl font-semibold text-white">All Clear!</h3>
            <p class="text-gray-400">No alerts matching your current filters.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Alert Details Modal -->
{#if selectedAlert}
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" 
       on:click={(e) => { if (e.target === e.currentTarget) closeAlertDetails() }}
       on:keydown={(e) => e.key === 'Escape' && closeAlertDetails()}
       role="dialog"
       aria-modal="true"
       aria-labelledby="alert-modal-title"
       tabindex="-1">
    <div class="bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-700" 
         role="document">
      <header class="p-6 flex justify-between items-center border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
        <h2 id="alert-modal-title" class="text-2xl font-bold text-white">Alert Details</h2>
        <button class="text-gray-400 hover:text-white" on:click={closeAlertDetails} aria-label="Close modal">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </header>

      <div class="p-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 mb-6">
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Severity</div>
            <span class="px-3 py-1 rounded-full text-sm font-semibold self-start {getSeverityBadgeClass(selectedAlert.severity)}">
              {selectedAlert.severity.toUpperCase()}
            </span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Alert Type</div>
            <span class="text-white capitalize">{selectedAlert.alertType.replace(/([A-Z])/g, ' $1').trim()}</span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Driver</div>
            <span class="text-white">{selectedAlert.driverName}</span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Vehicle</div>
            <span class="text-white">{selectedAlert.vehicleId}</span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Timestamp</div>
            <span class="text-white">{new Date(selectedAlert.timestamp).toLocaleString()}</span>
          </div>
           <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold text-gray-400 uppercase tracking-wider">Scenario</div>
            <span class="text-white capitalize">{selectedAlert.scenario.replace(/_/g, ' ')}</span>
          </div>
        </div>

        {#if selectedAlert.imageDataUrl}
          <div>
            <h3 class="text-lg font-bold text-white mb-2">📸 Alert Snapshot</h3>
            <img src={selectedAlert.imageDataUrl} alt="Alert snapshot" class="rounded-lg w-full border border-gray-700" />
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
