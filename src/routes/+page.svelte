<script>
  import FatigueDetector from '$lib/component/FatigueDetector.svelte';
</script>

<svelte:head>
  <title>Fatigue Monitoring System - Driver</title>
</svelte:head>

<div class="driver-page">
  <FatigueDetector />
</div>

<style>
  .driver-page {
    min-height: 100vh;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    padding: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
</style>
