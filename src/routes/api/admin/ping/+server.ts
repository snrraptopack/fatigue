import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    // Simple ping endpoint to check if the server is responsive
    return json({ 
      status: 'ok', 
      timestamp: Date.now(),
      message: 'Admin API is online'
    });
  } catch (error) {
    return json({ error: 'Server error' }, { status: 500 });
  }
};
