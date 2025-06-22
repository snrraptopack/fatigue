<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let showModal = false;

    let driverName = '';
    let driverId = '';

    const dispatch = createEventDispatcher();

    function handleSubmit() {
        if (driverName && driverId) {
            // Normalize the driver ID to ensure consistency
            const normalizedId = driverId.trim().toUpperCase();

            // Create a unique driver ID that combines name and vehicle ID
            // This ensures we can identify the same driver across sessions
            const uniqueDriverId = `${driverName.toLowerCase().replace(/\s+/g, '-')}-${normalizedId}`;

            dispatch('submit', { 
                driverName: driverName.trim(), 
                driverId: normalizedId,
                uniqueDriverId
            });

            showModal = false;

            // Store in localStorage for future sessions
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('driver-name', driverName.trim());
                localStorage.setItem('driver-id', normalizedId);
            }
        }
    }

    // Load saved values from localStorage on mount
    if (typeof document !== 'undefined') {
        driverName = localStorage.getItem('driver-name') || '';
        driverId = localStorage.getItem('driver-id') || '';
    }
</script>

{#if showModal}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 id="modal-title" class="text-2xl font-bold mb-4">Driver Information</h2>
        <form on:submit|preventDefault={handleSubmit}>
            <div class="mb-4">
                <label for="driverName" class="block text-gray-700 font-bold mb-2">Name</label>
                <input type="text" id="driverName" bind:value={driverName} class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" required>
            </div>
            <div class="mb-6">
                <label for="driverId" class="block text-gray-700 font-bold mb-2">Vehicle/Device ID</label>
                <input type="text" id="driverId" bind:value={driverId} class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-3 leading-tight focus:outline-none focus:shadow-outline" required>
            </div>
            <div class="flex items-center justify-end">
                <button type="submit" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline">
                    Save
                </button>
            </div>
        </form>
    </div>
</div>
{/if}
