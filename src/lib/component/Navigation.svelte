<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  
  $: currentPath = $page.url.pathname;
  
  function navigateToDriver() {
    goto('/');
  }
  
  function navigateToAdmin() {
    goto('/admin');
  }
</script>

<nav class="navigation">
  <div class="nav-container">
    <div class="logo">
      <span class="logo-icon">🚨</span>
      <span class="logo-text">FatigueWatch</span>
    </div>
    
    <div class="nav-links">
      <button 
        class="nav-button {currentPath === '/' ? 'active' : ''}"
        on:click={navigateToDriver}
      >
        <span class="nav-icon">👁️</span>
        Driver Monitor
      </button>
      
      <button 
        class="nav-button {currentPath === '/admin' ? 'active' : ''}"
        on:click={navigateToAdmin}
      >
        <span class="nav-icon">📊</span>
        Admin Dashboard
      </button>
    </div>
    
    <div class="nav-status">
      {#if currentPath === '/'}
        <span class="status-badge driver">Driver Mode</span>
      {:else if currentPath === '/admin'}
        <span class="status-badge admin">Admin Mode</span>
      {/if}
    </div>
  </div>
</nav>

<style>
  .navigation {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 1rem 0;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  
  .nav-container {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 2rem;
    gap: 2rem;
  }
  
  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: white;
    font-weight: 700;
    font-size: 1.25rem;
  }
  
  .logo-icon {
    font-size: 1.5rem;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.1); }
  }
  
  .nav-links {
    display: flex;
    gap: 1rem;
  }
  
  .nav-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    text-decoration: none;
  }
  
  .nav-button:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.4);
    transform: translateY(-2px);
  }
  
  .nav-button.active {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow: 0 4px 15px rgba(255, 255, 255, 0.2);
  }
  
  .nav-icon {
    font-size: 1.2rem;
  }
  
  .nav-status {
    display: flex;
    align-items: center;
  }
  
  .status-badge {
    padding: 0.5rem 1rem;
    border-radius: 20px;
    font-weight: 600;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .status-badge.driver {
    background: rgba(76, 175, 80, 0.9);
    color: white;
  }
  
  .status-badge.admin {
    background: rgba(255, 152, 0, 0.9);
    color: white;
  }
  
  @media (max-width: 768px) {
    .nav-container {
      flex-direction: column;
      gap: 1rem;
      padding: 0 1rem;
    }
    
    .nav-links {
      width: 100%;
      justify-content: center;
    }
    
    .nav-button {
      flex: 1;
      justify-content: center;
      min-width: 120px;
    }
    
    .logo {
      font-size: 1.1rem;
    }
  }
  
  @media (max-width: 480px) {
    .nav-links {
      flex-direction: column;
      width: 100%;
    }
    
    .nav-button {
      width: 100%;
    }
  }
</style>
