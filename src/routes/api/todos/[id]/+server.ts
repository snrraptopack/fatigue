// filepath: c:\Users\babyface\Desktop\fatigue-web\svelte-todo-pwa\src\routes\api\todos\[id]\+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { todos } from '../../../../lib/server/database'; // Import the shared map

// PUT /api/todos/[id] - Update a todo
export const PUT: RequestHandler = async ({ request, params }) => {
    const { completed } = await request.json();
    const id = Number(params.id);

    if (todos.has(id)) {
        const existingTodo = todos.get(id)!;
        const updatedTodo = { ...existingTodo, completed };
        todos.set(id, updatedTodo);
        return json(updatedTodo);
    }

    return json({ error: 'Todo not found' }, { status: 404 });
};

// DELETE /api/todos/[id] - Delete a todo
export const DELETE: RequestHandler = async ({ params }) => {
    const id = Number(params.id);

    if (todos.has(id)) {
        todos.delete(id);
        return new Response(null, { status: 204 }); // No Content
    }

    return json({ error: 'Todo not found' }, { status: 404 });
};