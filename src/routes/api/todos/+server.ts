// filepath: c:\Users\babyface\Desktop\fatigue-web\svelte-todo-pwa\src\routes\api\todos\+server.ts
import { json } from '@sveltejs/kit';
import { type RequestHandler } from '@sveltejs/kit';
import { todos } from '../../../lib/server/database'; // Import the shared map

// GET /api/todos - Get all todos
export const GET: RequestHandler = async () => {
    return json(Array.from(todos.values()));
};

// POST /api/todos - Create a new todo
export const POST: RequestHandler = async ({ request }) => {
    const { id, text, completed } = await request.json();
    if (!id || !text) {
        return json({ error: 'Missing required fields' }, { status: 400 });
    }
    const newTodo = { id, text, completed: !!completed };
    todos.set(id, newTodo);
    return json(newTodo, { status: 201 });
};