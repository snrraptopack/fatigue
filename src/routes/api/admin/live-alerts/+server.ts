import type { RequestHandler } from '@sveltejs/kit';
import { connectDB } from '$lib/server/mongodb';
import type { ChangeStream, ChangeStreamDocument } from 'mongodb';

// Store connected clients (controllers)
const clients = new Set<ReadableStreamDefaultController>();
let changeStream: ChangeStream | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

async function initializeChangeStream() {
  // Ensure change stream is initialized only once
  if (changeStream) {
    return;
  }

  try {
    const db = await connectDB();
    const alertsCollection = db.collection('alerts');
    changeStream = alertsCollection.watch([
      { $match: { operationType: 'insert' } }
    ]);

    changeStream.on('change', (change: ChangeStreamDocument) => {
      if (change.operationType === 'insert') {
        const newAlert = change.fullDocument;
        const message = `data: ${JSON.stringify({
          type: 'alert',
          data: newAlert
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


export const GET: RequestHandler = () => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  };

  let streamController: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      clients.add(streamController);
      
      if (clients.size === 1) {
        initializeChangeStream();
        startHeartbeat();
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
