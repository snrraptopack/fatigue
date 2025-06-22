// filepath: c:\Users\babyface\Desktop\fatigue-web\svelte-todo-pwa\src\lib\server\database.ts
export interface Todo {
    id: number;
    text: string;
    completed: boolean;
}

// In-memory "database" to simulate a real database
export const todos: Map<number, Todo> = new Map();

// Initialize with some dummy data only if the map is empty
if (todos.size === 0) {
    todos.set(1, { id: 1, text: 'Learn Svelte', completed: true });
    todos.set(2, { id: 2, text: 'Build an offline app', completed: false });
}