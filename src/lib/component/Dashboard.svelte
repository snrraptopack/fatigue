<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { getAllAlerts } from '$lib/storage';
  import type { FatigueAlert } from '$lib/storage';
  
  let alerts: FatigueAlert[] = [];
  let stats = {
    total: 0,
    today: 0,
    byType: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    byScenario: {} as Record<string, number>
  };
  
  let refreshInterval: number;
  
  onMount(async () => {
    if (!browser) return;
    
    await loadAlerts();
    
    // Listen for new alerts
    window.addEventListener('fatigue-alert', handleNewAlert);
    window.addEventListener('refresh-alerts', loadAlerts);
    
    // Refresh stats every 5 seconds
    refreshInterval = window.setInterval(loadAlerts, 5000);
  });
  
  onDestroy(() => {
    if (browser) {
      window.removeEventListener('fatigue-alert', handleNewAlert);
      window.removeEventListener('refresh-alerts', loadAlerts);
      if (refreshInterval) {
        window.clearInterval(refreshInterval);
      }
    }
  });
  
  async function loadAlerts() {
    alerts = await getAllAlerts();
    calculateStats();
  }
  
  function handleNewAlert(event: CustomEvent<FatigueAlert>) {
    alerts = [...alerts, event.detail];
    calculateStats();
  }
  
  function calculateStats() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    stats.total = alerts.length;
    stats.today = alerts.filter(alert => new Date(alert.timestamp) >= todayStart).length;
    
    // Reset counters
    stats.byType = {};
    stats.bySeverity = {};
    stats.byScenario = {};
    
    alerts.forEach(alert => {
      // Count by type
      stats.byType[alert.alertType] = (stats.byType[alert.alertType] || 0) + 1;
      
      // Count by severity
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      
      // Count by scenario
      stats.byScenario[alert.scenario] = (stats.byScenario[alert.scenario] || 0) + 1;
    });
  }
  
  function formatAlertType(type: string): string {
    return type.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  }
  
  function formatScenario(scenario: string): string {
    return scenario.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }
  
  function getSeverityColor(severity: string): string {
    const colors: Record<string, string> = {
      critical: '#D32F2F',
      high: '#F57C00',
      medium: '#FBC02D',
      low: '#388E3C'
    };
    return colors[severity] || '#666';
  }
</script>

<div class="dashboard">
  <h2>Detection Dashboard</h2>
  
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">{stats.total}</div>
      <div class="stat-label">Total Alerts</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-value">{stats.today}</div>
      <div class="stat-label">Today's Alerts</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-value">{alerts.filter(a => !a.acknowledged).length}</div>
      <div class="stat-label">Unacknowledged</div>
    </div>
    
    <div class="stat-card">
      <div class="stat-value">{alerts.filter(a => a.synced).length}</div>
      <div class="stat-label">Synced</div>
    </div>
  </div>
  
  <div class="charts-grid">
    <div class="chart-card">
      <h3>Alert Types</h3>
      <div class="chart-content">
        {#each Object.entries(stats.byType) as [type, count]}
          <div class="chart-bar">
            <span class="chart-label">{formatAlertType(type)}</span>
            <div class="chart-bar-container">
              <div 
                class="chart-bar-fill" 
                style="width: {(count / Math.max(...Object.values(stats.byType))) * 100}%"
              ></div>
              <span class="chart-value">{count}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
    
    <div class="chart-card">
      <h3>Severity Levels</h3>
      <div class="chart-content">
        {#each Object.entries(stats.bySeverity) as [severity, count]}
          <div class="chart-bar">
            <span class="chart-label" style="color: {getSeverityColor(severity)}">
              {severity.toUpperCase()}
            </span>
            <div class="chart-bar-container">
              <div 
                class="chart-bar-fill" 
                style="width: {(count / Math.max(...Object.values(stats.bySeverity))) * 100}%; background-color: {getSeverityColor(severity)}"
              ></div>
              <span class="chart-value">{count}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
    
    <div class="chart-card">
      <h3>Scenarios</h3>
      <div class="chart-content">
        {#each Object.entries(stats.byScenario) as [scenario, count]}
          <div class="chart-bar">
            <span class="chart-label">{formatScenario(scenario)}</span>
            <div class="chart-bar-container">
              <div 
                class="chart-bar-fill" 
                style="width: {(count / Math.max(...Object.values(stats.byScenario))) * 100}%"
              ></div>
              <span class="chart-value">{count}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .dashboard {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-bottom: 2rem;
    max-width: 1200px;
    margin: 0 auto 2rem;
  }
  
  .dashboard h2 {
    margin: 0 0 1.5rem 0;
    color: #333;
    text-align: center;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .stat-card {
    background: #f8f9fa;
    padding: 1.5rem;
    border-radius: 8px;
    text-align: center;
    border: 1px solid #e9ecef;
  }
  
  .stat-value {
    font-size: 2.5rem;
    font-weight: bold;
    color: #4CAF50;
    margin-bottom: 0.5rem;
  }
  
  .stat-label {
    font-size: 0.9rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .charts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
  }
  
  .chart-card {
    background: #f8f9fa;
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid #e9ecef;
  }
  
  .chart-card h3 {
    margin: 0 0 1rem 0;
    color: #333;
    text-align: center;
  }
  
  .chart-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .chart-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  
  .chart-label {
    min-width: 120px;
    font-size: 0.9rem;
    font-weight: 500;
  }
  
  .chart-bar-container {
    flex: 1;
    display: flex;
    align-items: center;
    height: 24px;
    background: #e9ecef;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
  }
  
  .chart-bar-fill {
    height: 100%;
    background: #4CAF50;
    transition: width 0.3s ease;
    border-radius: 12px;
  }
  
  .chart-value {
    position: absolute;
    right: 8px;
    font-size: 0.8rem;
    font-weight: bold;
    color: #333;
  }
  
  @media (max-width: 768px) {
    .dashboard {
      padding: 1rem;
    }
    
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .charts-grid {
      grid-template-columns: 1fr;
    }
    
    .stat-value {
      font-size: 2rem;
    }
  }
</style>
