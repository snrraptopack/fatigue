import { handleWebSocket } from '$lib/server/websockets';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    if (event.request.headers.get('upgrade') === 'websocket') {
        return handleWebSocket(event.request);
    }

    return resolve(event);
};
