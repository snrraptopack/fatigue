<script lang="ts">
	import '../app.css';
	import Navigation from '$lib/component/Navigation.svelte';
	
	let { children } = $props();
</script>

<Navigation />

<main class="main-content">
	{@render children()}
</main>

<style>
	.main-content {
		min-height: calc(100vh - 120px);
	}
</style>
