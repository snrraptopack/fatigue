<script lang="ts">
    import DriverModal from '../../lib/component/DriverModal.svelte';
    import FatigueDetector from '../../lib/component/FatigueDetector.svelte';
    import SnapshotGallery from '../../lib/component/SnapshotGallery.svelte';
    import { onMount, onDestroy } from 'svelte';
    import { browser } from '$app/environment';
    import { syncStatus, processSyncQueue, getUnsyncedAlerts } from '$lib/storage';

    let showModal = true;
    let driverInfo: { driverName: string, driverId: string, uniqueDriverId: string } | null = null;
    let wsConnection: WebSocket | null = null;
    let isConnected = false;
    let scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance' = 'workplace_fatigue';
    let streamActive = false;
    let videoStream: MediaStream | null = null;

    // Connection management
    let pingInterval: number;
    let reconnectTimeout: number;
    let reconnectAttempts = 0;

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

    function handleDriverSubmit(event: CustomEvent) {
        driverInfo = event.detail;
        showModal = false;
        if (driverInfo) {
            connectWebSocket();
        }
    }

    // Forward fatigue alerts to admin via WebSocket
    function handleFatigueAlert(event: CustomEvent) {
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN && driverInfo) {
            const alert = event.detail;
            wsConnection.send(JSON.stringify({
                type: 'alert',
                driverId: driverInfo.uniqueDriverId || `${driverInfo.driverName.toLowerCase().replace(/\s+/g, '-')}-${driverInfo.driverId.toLowerCase()}`,
                alert
            }));
            console.log('Alert sent via WebSocket:', alert);
        }
    }

    function connectWebSocket() {
        if (!browser || !driverInfo) return;

        // Clear any existing reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = undefined;
        }

        try {
            // Close existing connection if any
            if (wsConnection && wsConnection.readyState !== WebSocket.CLOSED) {
                wsConnection.close();
            }

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/ws`;

            wsConnection = new WebSocket(wsUrl);

            wsConnection.onopen = async () => {
                isConnected = true;
                console.log('WebSocket connection established');

                // Reset reconnect attempts on successful connection
                reconnectAttempts = 0;

                // Start ping interval
                startPingInterval();

                // Register driver with the server
                wsConnection?.send(JSON.stringify({
                    type: 'register',
                    driverId: driverInfo?.uniqueDriverId || `${driverInfo?.driverName.toLowerCase().replace(/\s+/g, '-')}-${driverInfo?.driverId.toLowerCase()}`,
                    driverName: driverInfo?.driverName,
                    vehicleId: driverInfo?.driverId
                }));

                // Check for unsynced alerts and sync them
                const unsyncedAlerts = await getUnsyncedAlerts();
                if (unsyncedAlerts.length > 0) {
                    console.log(`Found ${unsyncedAlerts.length} unsynced alerts. Starting sync...`);
                    await processSyncQueue(wsConnection);
                }
            };

            wsConnection.onclose = (event) => {
                isConnected = false;
                console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);

                // Stop ping interval
                stopPingInterval();

                // Stop video stream if active
                if (streamActive) {
                    stopVideoStream();
                }

                // Try to reconnect with exponential backoff
                const delay = Math.min(30000, 1000 * Math.pow(1.5, reconnectAttempts));
                reconnectAttempts++;
                console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
                reconnectTimeout = setTimeout(connectWebSocket, delay);
            };

            wsConnection.onerror = (error) => {
                console.error('WebSocket error:', error);
                isConnected = false;
            };

            wsConnection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('Received message:', data.type);

                    // Reset reconnect attempts on successful message
                    if (data.type !== 'pong') {
                        reconnectAttempts = 0;
                    }

                    // Handle different message types
                    switch (data.type) {
                        case 'scenario_change':
                            scenario = data.scenario;
                            console.log(`Scenario changed to: ${scenario}`);
                            break;

                        case 'stream_request':
                            if (data.active && !streamActive) {
                                console.log('Starting video stream');
                                startVideoStream();
                            } else if (!data.active && streamActive) {
                                console.log('Stopping video stream');
                                stopVideoStream();
                            }
                            break;

                        case 'sync_confirmation':
                            console.log(`Alert ${data.alertId} synced successfully`);
                            // Update sync status store
                            syncStatus.update(status => ({
                                ...status,
                                pendingCount: Math.max(0, status.pendingCount - 1),
                                lastSyncTime: Date.now()
                            }));
                            break;

                        case 'pong':
                            // Received pong from server, connection is alive
                            console.log('Received pong from server');
                            break;

                        case 'error':
                            // Handle error messages from server
                            console.error('Server error:', data.message);
                            break;

                        default:
                            console.log(`Unknown message type: ${data.type}`);
                    }
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
        }
    }

    async function startVideoStream() {
        if (!browser || !driverInfo || streamActive) return;

        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            streamActive = true;

            // Create a video element to capture frames
            const videoElement = document.createElement('video');
            videoElement.srcObject = videoStream;
            videoElement.autoplay = true;

            // Set up a canvas to capture frames
            const canvas = document.createElement('canvas');
            canvas.width = 320; // Lower resolution for better performance
            canvas.height = 240;
            const ctx = canvas.getContext('2d');

            // Send frames at regular intervals
            const frameInterval = setInterval(() => {
                if (!streamActive || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                    clearInterval(frameInterval);
                    stopVideoStream();
                    return;
                }

                if (ctx && videoElement.readyState >= 2) {
                    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                    const frameData = canvas.toDataURL('image/jpeg', 0.5); // Compressed JPEG

                    wsConnection.send(JSON.stringify({
                        type: 'video_frame',
                        driverId: driverInfo?.driverId,
                        frame: frameData,
                        timestamp: Date.now()
                    }));
                }
            }, 500); // Send 2 frames per second

        } catch (error) {
            console.error('Failed to start video stream:', error);
            streamActive = false;
        }
    }

    function stopVideoStream() {
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
        streamActive = false;
    }

    onMount(() => {
        if (driverInfo) {
            connectWebSocket();
        }

        // Listen for fatigue alerts from the FatigueDetector component
        if (browser) {
            window.addEventListener('fatigue-alert', handleFatigueAlert as EventListener);
        }
    });

    onDestroy(() => {
        // Stop ping interval
        stopPingInterval();

        // Clear reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = undefined;
        }

        // Close WebSocket connection
        if (wsConnection) {
            wsConnection.close();
        }

        // Stop video stream
        stopVideoStream();

        // Remove event listener to prevent memory leaks
        if (browser) {
            window.removeEventListener('fatigue-alert', handleFatigueAlert as EventListener);
        }
    });
</script>

<div class="min-h-screen bg-gray-100 p-4">
    <header class="bg-white shadow-md rounded-lg p-4 mb-6">
        <h1 class="text-2xl font-bold text-gray-800">Driver Monitoring System</h1>

        {#if driverInfo}
            <div class="mt-2 flex items-center justify-between">
                <div>
                    <p class="text-gray-600">
                        <strong class="font-semibold">Driver:</strong> {driverInfo.driverName}
                    </p>
                    <p class="text-gray-600">
                        <strong class="font-semibold">Vehicle ID:</strong> {driverInfo.driverId}
                    </p>
                </div>
                <div class="flex items-center">
                    <span class="w-3 h-3 rounded-full {isConnected ? 'bg-green-500' : 'bg-red-500'} mr-2"></span>
                    <span class="text-sm font-medium {isConnected ? 'text-green-600' : 'text-red-600'}">
                        {isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                    {#if streamActive}
                        <span class="ml-4 bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">Live Streaming</span>
                    {/if}
                </div>
            </div>
        {/if}
    </header>

    {#if driverInfo}
        <div class="bg-white shadow-md rounded-lg p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">Fatigue Detection</h2>
            <FatigueDetector 
                driverName={driverInfo.driverName} 
                vehicleId={driverInfo.driverId}
                scenario={scenario}
            />
        </div>

        <div class="bg-white shadow-md rounded-lg p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">Status</h2>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="bg-blue-50 p-4 rounded-lg">
                    <h3 class="font-medium text-blue-700">Current Mode</h3>
                    <p class="text-blue-900 capitalize">{scenario.replace('_', ' ')}</p>
                </div>
                <div class="bg-green-50 p-4 rounded-lg">
                    <h3 class="font-medium text-green-700">Connection</h3>
                    <p class="text-green-900">{isConnected ? 'Connected to Admin' : 'Local Only'}</p>
                </div>
                <div class="bg-purple-50 p-4 rounded-lg">
                    <h3 class="font-medium text-purple-700">Video Stream</h3>
                    <p class="text-purple-900">{streamActive ? 'Active' : 'Inactive'}</p>
                </div>
                <div class="bg-yellow-50 p-4 rounded-lg">
                    <h3 class="font-medium text-yellow-700">Data Sync</h3>
                    {#if $syncStatus.isSyncing}
                        <p class="text-yellow-900 flex items-center">
                            <span class="animate-spin mr-1 h-4 w-4 border-2 border-yellow-700 rounded-full border-t-transparent"></span>
                            Syncing...
                        </p>
                    {:else if $syncStatus.pendingCount > 0}
                        <p class="text-orange-700">
                            {$syncStatus.pendingCount} pending
                            {#if isConnected}
                                <button 
                                    class="ml-1 text-xs bg-orange-200 hover:bg-orange-300 text-orange-800 px-1 py-0.5 rounded"
                                    on:click={() => processSyncQueue(wsConnection)}
                                >
                                    Sync Now
                                </button>
                            {/if}
                        </p>
                    {:else if $syncStatus.lastSyncTime}
                        <p class="text-green-700">
                            All synced ({new Date($syncStatus.lastSyncTime).toLocaleTimeString()})
                        </p>
                    {:else}
                        <p class="text-gray-500">No data to sync</p>
                    {/if}
                    {#if $syncStatus.error}
                        <p class="text-red-600 text-xs mt-1">{$syncStatus.error}</p>
                    {/if}
                </div>
            </div>
        </div>

        <div class="bg-white shadow-md rounded-lg p-6">
            <SnapshotGallery 
                driverName={driverInfo.driverName} 
                vehicleId={driverInfo.driverId}
            />
        </div>
    {:else}
        <div class="bg-white shadow-md rounded-lg p-6 text-center">
            <h2 class="text-xl font-semibold mb-4 text-gray-800">Driver Registration</h2>
            <p class="text-gray-600 mb-4">Please enter your information to start the monitoring system.</p>
            <button on:click={() => showModal = true} class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">
                Enter Driver Information
            </button>
        </div>
    {/if}

    <DriverModal bind:showModal on:submit={handleDriverSubmit} />
</div>
