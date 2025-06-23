
import { connectDB } from './mongodb';

// Clear hardcoded driver data from MongoDB on server start
async function clearHardcodedDrivers() {
    try {
        const db = await connectDB();
        const driversCollection = db.collection('drivers');

        // List of hardcoded driver IDs to remove
        const hardcodedDriverIds = [
            'john-truck-001',
            'maria-truck-002',
            'david-forklift-003'
        ];

        // Remove hardcoded drivers
        const result = await driversCollection.deleteMany({
            driverId: { $in: hardcodedDriverIds }
        });

        console.log(`Cleared ${result.deletedCount} hardcoded drivers from MongoDB`);
    } catch (error) {
        console.error('Failed to clear hardcoded drivers:', error);
    }
}

// Run cleanup on startup
clearHardcodedDrivers();

// Enhanced driver info with streaming and recording status
interface DriverInfo {
    driverName: string;
    driverId: string;
    socket: WebSocket | any; // Using any to handle both ws and Deno WebSocket
    isStreaming: boolean;
    isRecording: boolean;
    lastSeen: number;
    scenario: string;
    status: string;
    vehicleId?: string;
}

// Store for the last frame from each driver for new admin connections
interface FrameCache {
    frame: string;
    timestamp: number;
}

const connectedDrivers = new Map<string, DriverInfo>();
const adminClients = new Set<any>(); // Using any to handle Deno WebSocket
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
        if (client.readyState === 1) { // 1 = OPEN in WebSocket standard
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
        if (client.readyState === 1) { // 1 = OPEN in WebSocket standard
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
        if (!driver) {
            console.error(`Cannot update status for unknown driver: ${driverId}`);
            return;
        }

        console.log(`Updating driver status in MongoDB: ${driver.driverName} (${driverId}) - ${status}`);

        // Check if driver already exists in MongoDB
        const existingDriver = await driversCollection.findOne({ driverId });
        if (existingDriver) {
            console.log(`Found existing driver in MongoDB: ${driver.driverName} (${driverId})`);
        } else {
            console.log(`Driver not found in MongoDB, will create new entry: ${driver.driverName} (${driverId})`);
        }

        // Update or insert driver document
        const result = await driversCollection.updateOne(
            { driverId },
            { 
                $set: { 
                    status,
                    lastSeen: new Date(),
                    name: driver.driverName,
                    vehicleId: driver.vehicleId || driver.driverId.split('-').pop() || driver.driverId,
                    scenario: driver.scenario || 'workplace_fatigue'
                }
            },
            { upsert: true }
        );

        if (result.matchedCount > 0) {
            console.log(`Driver status updated successfully: ${driver.driverName} (${driverId})`);
        } else if (result.upsertedCount > 0) {
            console.log(`New driver created in MongoDB: ${driver.driverName} (${driverId})`);
        } else {
            console.log(`No changes made to driver in MongoDB: ${driver.driverName} (${driverId})`);
        }

        // List all drivers in MongoDB for debugging
        const allDrivers = await driversCollection.find({}).toArray();
        console.log(`Total drivers in MongoDB: ${allDrivers.length}`);
        allDrivers.forEach(d => {
            console.log(`MongoDB driver: ${d.name} (${d.driverId}) - ${d.status}`);
        });
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

            case 'recording_status':
                // Change recording status for a driver
                if (data.driverId) {
                    sendToDriver(data.driverId, {
                        type: 'recording_status',
                        active: data.active
                    });

                    // Update driver recording status
                    const driver = connectedDrivers.get(data.driverId);
                    if (driver) {
                        driver.isRecording = data.active;

                        // If recording is starting, ensure streaming is active
                        if (data.active && !driver.isStreaming) {
                            driver.isStreaming = true;
                            sendToDriver(data.driverId, {
                                type: 'stream_request',
                                active: true
                            });
                        }

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

            case 'acknowledge_alert':
                // Acknowledge an alert
                if (data.alertId) {
                    handleAlertAcknowledgement(data.alertId);
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

// Handle alert acknowledgement
async function handleAlertAcknowledgement(alertId: string) {
    try {
        const db = await connectDB();
        const alertsCollection = db.collection('alerts');

        // Update the alert in MongoDB
        await alertsCollection.updateOne(
            { id: alertId },
            { $set: { acknowledged: true } }
        );

        console.log(`Alert ${alertId} acknowledged`);

        // Broadcast the acknowledgement to all admin clients
        adminClients.forEach(client => {
            if (client.readyState === 1) { // 1 = OPEN in WebSocket standard
                client.send(JSON.stringify({
                    type: 'alert_acknowledged',
                    alertId
                }));
            }
        });
    } catch (error) {
        console.error('Failed to acknowledge alert:', error);
    }
}

// Handle driver registration
function handleDriverRegistration(socket: any, data: any) {
    const { driverId, driverName, vehicleId } = data;
    if (driverId && driverName) {
        console.log(`Registering driver: ${driverName} (${driverId}) with vehicle ${vehicleId || 'unknown'}`);

        // Check if driver is already registered
        const existingDriver = connectedDrivers.get(driverId);

        // If driver exists, update the socket and lastSeen
        if (existingDriver) {
            console.log(`Driver ${driverName} (${driverId}) reconnected`);

            // Update existing driver info
            existingDriver.socket = socket;
            existingDriver.lastSeen = Date.now();
            existingDriver.status = 'active';

            // Update vehicleId if provided
            if (vehicleId) {
                existingDriver.vehicleId = vehicleId;
            }

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
                vehicleId: vehicleId || driverId.split('-').pop() || 'unknown',
                socket,
                isStreaming: false,
                isRecording: false,
                lastSeen: Date.now(),
                scenario: 'workplace_fatigue',
                status: 'active'
            });
            console.log(`New driver ${driverName} (${driverId}) added to connected drivers map`);
        }

        // Update driver status in MongoDB
        updateDriverStatus(driverId, 'active');

        // Broadcast updated driver list to all admin clients
        broadcastDrivers();
        console.log(`Driver list broadcasted to ${adminClients.size} admin clients`);
    } else {
        console.error('Driver registration missing required data', data);
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
async function handleAlert(data: any) {
    try {
        // Extract alert data
        const alert = data.alert;
        const driverId = data.driverId;

        if (!alert || !driverId) {
            console.error('Alert missing required data', data);
            return;
        }

        // Update driver status in MongoDB
        const driver = connectedDrivers.get(driverId);
        if (driver) {
            driver.lastSeen = Date.now();
            driver.status = alert.severity === 'critical' ? 'critical' : 'alert';

            // Update driver status in MongoDB
            await updateDriverStatus(driverId, driver.status);

            // Broadcast updated driver list to all admin clients
            broadcastDrivers();
        } else {
            console.log(`Alert received from unknown driver: ${driverId}`);
        }

        // Forward alert to admin clients
        adminClients.forEach(client => {
            if (client.readyState === 1) { // 1 = OPEN in WebSocket standard
                client.send(JSON.stringify({
                    type: 'alert',
                    data: alert
                }));
            }
        });
    } catch (error) {
        console.error('Error handling alert:', error);
    }
}

// Handle sync alert from driver (for offline data synchronization)
async function handleSyncAlert(data: any) {
    try {
        if (!data.alert) {
            console.error('Sync alert missing alert data');
            return;
        }

        const alert = data.alert;
        const driverId = data.driverId;

        console.log(`Processing sync alert from driver ${driverId || 'unknown'}: ${alert.alertType} (${alert.severity})`);

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
            console.log(`Updated existing alert in MongoDB: ${alert.id}`);
        } else {
            // Insert new alert
            await alertsCollection.insertOne({
                ...alert,
                synced: true
            });
            console.log(`Inserted new alert into MongoDB: ${alert.id}`);
        }

        // Update driver status
        if (driverId) {
            // If we have a driverId from the message, use it
            const driver = connectedDrivers.get(driverId);
            if (driver) {
                driver.lastSeen = Date.now();
                driver.status = alert.severity === 'critical' ? 'critical' : 'alert';
                await updateDriverStatus(driverId, driver.status);
                broadcastDrivers();
            } else {
                // If driver not found in connectedDrivers, try to create a new entry
                const uniqueDriverId = `${alert.driverName.toLowerCase().replace(/\s+/g, '-')}-${alert.vehicleId.toLowerCase()}`;
                console.log(`Driver not found in connected drivers. Creating entry with ID: ${uniqueDriverId}`);

                // Create a placeholder driver entry (without socket)
                connectedDrivers.set(uniqueDriverId, {
                    driverName: alert.driverName,
                    driverId: uniqueDriverId,
                    vehicleId: alert.vehicleId,
                    isStreaming: false,
                    lastSeen: Date.now(),
                    scenario: 'workplace_fatigue',
                    status: alert.severity === 'critical' ? 'critical' : 'alert',
                    socket: null,
                    isRecording:false
                });

                await updateDriverStatus(uniqueDriverId, alert.severity === 'critical' ? 'critical' : 'alert');
                broadcastDrivers();
            }
        }

        // Forward alert to admin clients
        adminClients.forEach(client => {
            if (client.readyState === 1) { // 1 = OPEN in WebSocket standard
                client.send(JSON.stringify({
                    type: 'alert',
                    data: alert
                }));
            }
        });

        // Send confirmation back to driver if we have a driverId and the driver is connected
        if (driverId) {
            const driver = connectedDrivers.get(driverId);
            if (driver && driver.socket) {
                try {
                    driver.socket.send(JSON.stringify({
                        type: 'sync_confirmation',
                        alertId: alert.id,
                        success: true
                    }));
                    console.log(`Sent sync confirmation to driver ${driverId} for alert ${alert.id}`);
                } catch (error) {
                    console.error(`Failed to send sync confirmation to driver ${driverId}:`, error);
                }
            } else {
                console.log(`Cannot send sync confirmation: Driver ${driverId} not connected`);
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
            try {
                ws.close();
            } catch (e) {
                console.error('Error closing connection:', e);
            }
            adminClients.delete(ws);
            return;
        }

        (ws as any).isAlive = false;
        try {
            // Deno WebSocket doesn't have ping method, send a ping message instead
            ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
            console.error('Error sending ping:', e);
            try {
                ws.close();
            } catch (e) {
                console.error('Error closing connection:', e);
            }
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
