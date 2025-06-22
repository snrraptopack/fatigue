import type { RequestHandler } from '@sveltejs/kit';
import { connectDB } from '$lib/server/mongodb';
import type { ChangeStream, ChangeStreamDocument } from 'mongodb';

// Store connected clients (controllers)
const clients = new Set<ReadableStreamDefaultController>();
let changeStream: ChangeStream | null = null;
let heartbeatInterval: number | null = null;
let frameCache = new Map<string, { frame: string, timestamp: number, driverId: string }>();

// Maximum number of frames to cache per driver
const MAX_FRAMES_PER_DRIVER = 10;

async function initializeChangeStream() {
  // Ensure change stream is initialized only once
  if (changeStream) {
    return;
  }

  try {
    const db = await connectDB();
    const recordingsCollection = db.collection('recordings');
    changeStream = recordingsCollection.watch([
      { $match: { operationType: 'insert' } }
    ]);

    changeStream.on('change', (change: ChangeStreamDocument) => {
      if (change.operationType === 'insert') {
        const newFrame = change.fullDocument;
        
        // Cache the frame
        cacheFrame(newFrame.driverId, newFrame.frame, newFrame.timestamp);
        
        const message = `data: ${JSON.stringify({
          type: 'frame',
          data: {
            driverId: newFrame.driverId,
            frame: newFrame.frame,
            timestamp: newFrame.timestamp
          }
        })}\n\n`;
        
        // Send to all connected clients
        for (const client of clients) {
          try {
            client.enqueue(message);
          } catch (e) {
            // The client is likely disconnected. It will be removed in the `cancel` function.
          }
        }
      }
    });

    changeStream.on('error', (error: any) => {
      console.error('Change stream error:', error);
      closeChangeStream();
    });

  } catch (error) {
    console.error('Failed to initialize change stream:', error);
    changeStream = null;
  }
}

function cacheFrame(driverId: string, frame: string, timestamp: number) {
  // Create a unique key for this frame
  const key = `${driverId}-${timestamp}`;
  
  // Add to cache
  frameCache.set(key, { driverId, frame, timestamp });
  
  // Limit cache size by removing oldest frames if needed
  const driverFrames = Array.from(frameCache.entries())
    .filter(([k, v]) => v.driverId === driverId)
    .sort((a, b) => b[1].timestamp - a[1].timestamp);
  
  if (driverFrames.length > MAX_FRAMES_PER_DRIVER) {
    // Remove oldest frames
    for (let i = MAX_FRAMES_PER_DRIVER; i < driverFrames.length; i++) {
      frameCache.delete(driverFrames[i][0]);
    }
  }
}

function closeChangeStream() {
    if (changeStream) {
        changeStream.close();
        changeStream = null;
    }
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function startHeartbeat() {
    // Ensure heartbeat is started only once
    if (heartbeatInterval) {
        return;
    }
    // Send heartbeat every 30 seconds to keep connections alive
    heartbeatInterval = setInterval(() => {
        const message = `data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now()
        })}\n\n`;
        for (const client of clients) {
            try {
                client.enqueue(message);
            } catch (e) {
                // The client is likely disconnected. It will be removed in the `cancel` function.
            }
        }
    }, 30000);
}

export const GET: RequestHandler = ({ url }) => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  };

  // Check if a specific driver ID is requested
  const driverId = url.searchParams.get('driverId');

  let streamController: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      clients.add(streamController);
      
      if (clients.size === 1) {
        initializeChangeStream();
        startHeartbeat();
      }

      // Send cached frames for the requested driver
      if (driverId) {
        const cachedFrames = Array.from(frameCache.values())
          .filter(frame => frame.driverId === driverId)
          .sort((a, b) => b.timestamp - a.timestamp);
        
        if (cachedFrames.length > 0) {
          // Send the most recent frames first
          for (const frame of cachedFrames) {
            try {
              controller.enqueue(`data: ${JSON.stringify({
                type: 'frame',
                data: {
                  driverId: frame.driverId,
                  frame: frame.frame,
                  timestamp: frame.timestamp
                }
              })}\n\n`);
            } catch (e) {
              console.error('Error sending cached frame:', e);
            }
          }
        }
      }
    },
    cancel() {
      if (streamController) {
        clients.delete(streamController);
      }
      
      if (clients.size === 0) {
        closeChangeStream();
      }
    }
  });

  return new Response(stream, { headers });
};

// Store video frame in MongoDB
export const POST: RequestHandler = async ({ request }) => {
  try {
    const data = await request.json();
    
    if (!data.driverId || !data.frame) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const db = await connectDB();
    const recordingsCollection = db.collection('recordings');
    
    const timestamp = data.timestamp || Date.now();
    
    // Insert the frame into MongoDB
    await recordingsCollection.insertOne({
      driverId: data.driverId,
      frame: data.frame,
      timestamp,
      alertId: data.alertId || null,
      metadata: data.metadata || {}
    });
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error storing video frame:', error);
    return new Response(JSON.stringify({ error: 'Failed to store video frame' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};