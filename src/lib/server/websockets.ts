
import { WebSocketServer, WebSocket } from 'ws';
import { connectDB } from './mongodb';

// Enhanced driver info with streaming status
interface DriverInfo {
    driverName: string;
    driverId: string;
    socket: WebSocket | any; // Using any to handle both ws and Deno WebSocket
    isStreaming: boolean;
    lastSeen: number;
    scenario: string;
    status: string;
}

// Store for the last frame from each driver for new admin connections
interface FrameCache {
    frame: string;
    timestamp: number;
}

const connectedDrivers = new Map<string, DriverInfo>();
const adminClients = new Set<WebSocket>();
const frameCache = new Map<string, FrameCache>();

// Broadcast driver list to all admin clients
function broadcastDrivers() {
    const driverList = Array.from(connectedDrivers.values()).map(({ socket, ...driverInfo }) => ({
        ...driverInfo,
        hasFrame: frameCache.has(driverInfo.driverId)
    }));

    const message = JSON.stringify({ 
        type: 'drivers', 
        drivers: driverList 
    });

    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Send a message to a specific driver
function sendToDriver(driverId: string, message: any) {
    const driver = connectedDrivers.get(driverId);
    if (driver && driver.socket) {
        try {
            const messageStr = JSON.stringify(message);
            if (driver.socket.send) {
                driver.socket.send(messageStr);
            }
        } catch (error) {
            console.error(`Failed to send message to driver ${driverId}:`, error);
        }
    }
}

// Broadcast a video frame to all admin clients
function broadcastFrame(driverId: string, frame: string, timestamp: number) {
    // Cache the latest frame
    frameCache.set(driverId, { frame, timestamp });

    // Only send to admins who are actively viewing this driver
    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            // We could add a mechanism to track which driver each admin is viewing
            // For now, we'll send to all admins
            client.send(JSON.stringify({
                type: 'video_frame',
                driverId,
                frame,
                timestamp
            }));
        }
    });
}

// Update driver status in MongoDB
async function updateDriverStatus(driverId: string, status: string) {
    try {
        const db = await connectDB();
        const driversCollection = db.collection('drivers');

        const driver = connectedDrivers.get(driverId);
        if (!driver) return;

        await driversCollection.updateOne(
            { driverId },
            { 
                $set: { 
                    status,
                    lastSeen: new Date(),
                    name: driver.driverName,
                    vehicleId: driver.driverId.split('-').pop() || driver.driverId,
                    scenario: driver.scenario || 'workplace_fatigue'
                }
            },
            { upsert: true }
        );
    } catch (error) {
        console.error(`Failed to update driver status in MongoDB:`, error);
    }
}

// Handle WebSocket connections from driver pages or admin clients
export function handleWebSocket(request: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(request);

    // Add isAlive property for heartbeat
    (socket as any).isAlive = true;

    // We'll determine if this is an admin connection based on messages
    let isAdmin = false;

    socket.onopen = () => {
        console.log("WebSocket connection opened.");
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            // Reset heartbeat on any message
            (socket as any).isAlive = true;

            // Check for identify message to determine if this is an admin connection
            if (data.type === 'identify' && data.role === 'admin') {
                isAdmin = true;
                console.log("Client identified as admin dashboard");
                adminClients.add(socket as unknown as WebSocket);

                // Send initial driver list
                const driverList = Array.from(connectedDrivers.values()).map(({ socket, ...driverInfo }) => ({
                    ...driverInfo,
                    hasFrame: frameCache.has(driverInfo.driverId)
                }));

                try {
                    socket.send(JSON.stringify({ 
                        type: 'drivers', 
                        drivers: driverList 
                    }));
                } catch (error) {
                    console.error("Failed to send initial driver list to admin:", error);
                }

                return;
            }

            // Handle ping from any client
            if (data.type === 'ping') {
                // Respond to ping with pong
                try {
                    socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                } catch (error) {
                    console.error("Failed to send pong:", error);
                }
                return;
            }

            if (isAdmin) {
                // Handle admin messages
                handleAdminMessage(socket as unknown as WebSocket, data);
            } else {
                // Handle driver messages
                switch (data.type) {
                    case 'register':
                        handleDriverRegistration(socket, data);
                        break;

                    case 'video_frame':
                        handleVideoFrame(data);
                        break;

                    case 'alert':
                        handleAlert(data);
                        break;

                    case 'sync_alert':
                        handleSyncAlert(data);
                        break;

                    case 'status_update':
                        handleStatusUpdate(data);
                        break;

                    default:
                        console.log(`Unknown message type from driver: ${data.type}`);
                }
            }
        } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
        }
    };

    socket.onclose = () => {
        console.log(`WebSocket connection closed. ${isAdmin ? 'Admin' : 'Driver'} connection.`);

        if (isAdmin) {
            adminClients.delete(socket as unknown as WebSocket);
        } else {
            // Check if this socket belongs to any driver
            handleDriverDisconnect(socket);
        }
    };

    socket.onerror = (error) => {
        console.error("WebSocket error:", error);
    };

    return response;
}

// Handle messages from admin clients
function handleAdminMessage(ws: WebSocket, data: any) {
    try {
        // Handle different message types
        switch (data.type) {
            case 'stream_request':
                // Request to start/stop streaming from a driver
                if (data.driverId) {
                    sendToDriver(data.driverId, {
                        type: 'stream_request',
                        active: data.active
                    });

                    // Update driver streaming status
                    const driver = connectedDrivers.get(data.driverId);
                    if (driver) {
                        driver.isStreaming = data.active;
                        broadcastDrivers();
                    }
                }
                break;

            case 'scenario_change':
                // Change scenario for a driver
                if (data.driverId && data.scenario) {
                    sendToDriver(data.driverId, {
                        type: 'scenario_change',
                        scenario: data.scenario
                    });

                    // Update driver scenario
                    const driver = connectedDrivers.get(data.driverId);
                    if (driver) {
                        driver.scenario = data.scenario;
                        broadcastDrivers();
                    }
                }
                break;

            case 'get_frame':
                // Request for the latest frame from a driver
                if (data.driverId) {
                    const cachedFrame = frameCache.get(data.driverId);
                    if (cachedFrame) {
                        ws.send(JSON.stringify({
                            type: 'video_frame',
                            driverId: data.driverId,
                            frame: cachedFrame.frame,
                            timestamp: cachedFrame.timestamp
                        }));
                    }
                }
                break;

            // Ping/pong is handled in the main message handler

            default:
                console.log(`Unknown message type from admin: ${data.type}`);
        }
    } catch (error) {
        console.error('Failed to handle admin message:', error);
    }
}

// Handle driver registration
function handleDriverRegistration(socket: any, data: any) {
    const { driverId, driverName } = data;
    if (driverId && driverName) {
        console.log(`Registering driver: ${driverName} (${driverId})`);

        // Check if driver is already registered
        const existingDriver = connectedDrivers.get(driverId);

        // If driver exists, update the socket and lastSeen
        if (existingDriver) {
            console.log(`Driver ${driverName} (${driverId}) reconnected`);

            // Update existing driver info
            existingDriver.socket = socket;
            existingDriver.lastSeen = Date.now();
            existingDriver.status = 'active';

            // Send current scenario to the reconnected driver
            if (socket.send) {
                try {
                    socket.send(JSON.stringify({
                        type: 'scenario_change',
                        scenario: existingDriver.scenario
                    }));
                } catch (error) {
                    console.error(`Failed to send scenario to reconnected driver ${driverId}:`, error);
                }
            }
        } else {
            // Create new driver entry
            connectedDrivers.set(driverId, { 
                driverName, 
                driverId, 
                socket,
                isStreaming: false,
                lastSeen: Date.now(),
                scenario: 'workplace_fatigue',
                status: 'active'
            });
        }

        // Update driver status in MongoDB
        updateDriverStatus(driverId, 'active');

        // Broadcast updated driver list to all admin clients
        broadcastDrivers();
    }
}

// Handle video frame from driver
function handleVideoFrame(data: any) {
    const { driverId, frame, timestamp } = data;
    if (driverId && frame) {
        const driver = connectedDrivers.get(driverId);
        if (driver) {
            driver.lastSeen = timestamp || Date.now();
            driver.isStreaming = true;

            // Broadcast frame to admin clients
            broadcastFrame(driverId, frame, driver.lastSeen);
        }
    }
}

// Handle alert from driver
function handleAlert(data: any) {
    // Forward alert to admin clients
    adminClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'alert',
                data
            }));
        }
    });
}

// Handle sync alert from driver (for offline data synchronization)
async function handleSyncAlert(data: any) {
    try {
        if (!data.alert) {
            console.error('Sync alert missing alert data');
            return;
        }

        const alert = data.alert;

        // Save alert to MongoDB
        const db = await connectDB();
        const alertsCollection = db.collection('alerts');

        // Check if alert already exists
        const existingAlert = await alertsCollection.findOne({ id: alert.id });

        if (existingAlert) {
            // Update existing alert
            await alertsCollection.updateOne(
                { id: alert.id },
                { $set: { ...alert, synced: true } }
            );
        } else {
            // Insert new alert
            await alertsCollection.insertOne({
                ...alert,
                synced: true
            });
        }

        // Update driver status
        const driverId = `${alert.driverName.toLowerCase().replace(' ', '-')}-${alert.vehicleId.toLowerCase()}`;
        await updateDriverStatus(
            driverId, 
            alert.severity === 'critical' ? 'critical' : 'alert'
        );

        // Forward alert to admin clients
        adminClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'alert',
                    data: alert
                }));
            }
        });

        // Send confirmation back to driver
        const driver = Array.from(connectedDrivers.values())
            .find(d => d.driverName === alert.driverName && d.driverId.includes(alert.vehicleId));

        if (driver && driver.socket) {
            try {
                driver.socket.send(JSON.stringify({
                    type: 'sync_confirmation',
                    alertId: alert.id,
                    success: true
                }));
            } catch (error) {
                console.error('Failed to send sync confirmation:', error);
            }
        }
    } catch (error) {
        console.error('Error handling sync alert:', error);
    }
}

// Handle status update from driver
function handleStatusUpdate(data: any) {
    const { driverId, status } = data;
    if (driverId && status) {
        const driver = connectedDrivers.get(driverId);
        if (driver) {
            driver.status = status;
            driver.lastSeen = Date.now();

            // Update driver status in MongoDB
            updateDriverStatus(driverId, status);

            // Broadcast updated driver list to all admin clients
            broadcastDrivers();
        }
    }
}

// Handle driver disconnect
function handleDriverDisconnect(socket: any) {
    for (const [driverId, driver] of connectedDrivers.entries()) {
        if (driver.socket === socket) {
            connectedDrivers.delete(driverId);
            console.log(`Driver ${driver.driverName} (${driverId}) disconnected.`);

            // Update driver status in MongoDB
            updateDriverStatus(driverId, 'inactive');

            // Broadcast updated driver list to all admin clients
            broadcastDrivers();
            break;
        }
    }
}

// Heartbeat mechanism to detect and close dead connections
function heartbeat() {
    this.isAlive = true;
}

// Heartbeat interval to check for dead connections
const heartbeatInterval = setInterval(() => {
    adminClients.forEach(ws => {
        if ((ws as any).isAlive === false) {
            console.log('Terminating dead admin connection');
            ws.terminate();
            adminClients.delete(ws);
            return;
        }

        (ws as any).isAlive = false;
        try {
            ws.ping();
        } catch (e) {
            console.error('Error sending ping:', e);
            ws.terminate();
            adminClients.delete(ws);
        }
    });
}, 30000); // Check every 30 seconds

// Clean up inactive drivers every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [driverId, driver] of connectedDrivers.entries()) {
        // If driver hasn't been seen in 10 minutes, consider them disconnected
        if (now - driver.lastSeen > 10 * 60 * 1000) {
            connectedDrivers.delete(driverId);
            console.log(`Driver ${driver.driverName} (${driverId}) timed out.`);

            // Update driver status in MongoDB
            updateDriverStatus(driverId, 'inactive');
        }
    }

    // Broadcast updated driver list to all admin clients
    if (adminClients.size > 0) {
        broadcastDrivers();
    }
}, 5 * 60 * 1000);

// No need to export wss anymore as we're handling all connections in handleWebSocket
