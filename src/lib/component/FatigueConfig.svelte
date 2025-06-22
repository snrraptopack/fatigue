<script lang="ts">
  import type { FatigueAlert } from '$lib/storage';
  
  export let scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance' = 'workplace_fatigue';
  export let driverName: string = 'Test Driver';
  export let vehicleId: string = 'V001';
  
  const scenarios = [
    {
      id: 'workplace_fatigue',
      name: 'Workplace Fatigue',
      description: 'Monitor employees for signs of fatigue during work hours',
      features: ['Eye closure detection', 'Head down monitoring', 'Yawning detection'],
      color: '#FF9800'
    },
    {
      id: 'driving_distraction',
      name: 'Driving Distraction',
      description: 'Critical safety monitoring for vehicle operators',
      features: ['Drowsiness alerts', 'Looking away detection', 'Head position tracking'],
      color: '#E91E63'
    },
    {
      id: 'attention_monitoring',
      name: 'Attention Monitoring',
      description: 'Monitor focus and attention levels during tasks',
      features: ['Face detection', 'Eye tracking', 'Distraction alerts'],
      color: '#9C27B0'
    },
    {
      id: 'safety_compliance',
      name: 'Safety Compliance',
      description: 'Ensure safety protocols are followed in work environments',
      features: ['Continuous monitoring', 'Alert logging', 'Compliance reporting'],
      color: '#607D8B'
    }
  ];
  
  function handleScenarioChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    scenario = target.value as typeof scenario;
  }
</script>

<div class="config-panel">
  <h2>Fatigue Detection Configuration</h2>
  
  <div class="config-grid">
    <div class="config-section">
      <label for="driver-name">Driver/Employee Name:</label>
      <input 
        id="driver-name"
        type="text" 
        bind:value={driverName} 
        placeholder="Enter name"
      />
    </div>
    
    <div class="config-section">
      <label for="vehicle-id">Vehicle/Workstation ID:</label>
      <input 
        id="vehicle-id"
        type="text" 
        bind:value={vehicleId} 
        placeholder="Enter ID"
      />
    </div>
    
    <div class="config-section full-width">
      <label for="scenario">Detection Scenario:</label>
      <select id="scenario" bind:value={scenario} on:change={handleScenarioChange}>
        {#each scenarios as scenarioOption}
          <option value={scenarioOption.id}>
            {scenarioOption.name}
          </option>
        {/each}
      </select>
    </div>
  </div>
  
  <div class="scenario-info">
    {#each scenarios as scenarioOption}
      {#if scenarioOption.id === scenario}
        <div class="scenario-details" style="border-color: {scenarioOption.color}">
          <h3 style="color: {scenarioOption.color}">{scenarioOption.name}</h3>
          <p>{scenarioOption.description}</p>
          <div class="features">
            <h4>Active Features:</h4>
            <ul>
              {#each scenarioOption.features as feature}
                <li>{feature}</li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
    {/each}
  </div>
  
  <div class="alert-mapping">
    <h3>Alert Severity Mapping</h3>
    <div class="severity-grid">
      <div class="severity-item critical">Critical</div>
      <div class="severity-item high">High</div>
      <div class="severity-item medium">Medium</div>
      <div class="severity-item low">Low</div>
    </div>
    <p class="mapping-note">
      Alert severity levels are automatically adjusted based on the selected scenario.
      Critical alerts require immediate attention, while low alerts are logged for analysis.
    </p>
  </div>
</div>

<style>
  .config-panel {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    margin-bottom: 2rem;
    max-width: 800px;
    margin: 0 auto 2rem;
  }
  
  .config-panel h2 {
    margin: 0 0 1.5rem 0;
    color: #333;
    text-align: center;
  }
  
  .config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 2rem;
  }
  
  .config-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .config-section.full-width {
    grid-column: 1 / -1;
  }
  
  .config-section label {
    font-weight: bold;
    color: #555;
  }
  
  .config-section input,
  .config-section select {
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 1rem;
  }
  
  .config-section input:focus,
  .config-section select:focus {
    outline: none;
    border-color: #4CAF50;
    box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
  }
  
  .scenario-info {
    margin-bottom: 2rem;
  }
  
  .scenario-details {
    padding: 1.5rem;
    border: 2px solid;
    border-radius: 8px;
    background: #f9f9f9;
  }
  
  .scenario-details h3 {
    margin: 0 0 1rem 0;
  }
  
  .scenario-details p {
    margin: 0 0 1rem 0;
    color: #666;
  }
  
  .features h4 {
    margin: 0 0 0.5rem 0;
    color: #333;
  }
  
  .features ul {
    margin: 0;
    padding-left: 1.5rem;
  }
  
  .features li {
    margin-bottom: 0.25rem;
    color: #555;
  }
  
  .alert-mapping {
    text-align: center;
  }
  
  .alert-mapping h3 {
    margin: 0 0 1rem 0;
    color: #333;
  }
  
  .severity-grid {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-bottom: 1rem;
  }
  
  .severity-item {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: bold;
    color: white;
    min-width: 80px;
  }
  
  .severity-item.critical {
    background-color: #D32F2F;
  }
  
  .severity-item.high {
    background-color: #F57C00;
  }
  
  .severity-item.medium {
    background-color: #FBC02D;
    color: #333;
  }
  
  .severity-item.low {
    background-color: #388E3C;
  }
  
  .mapping-note {
    font-size: 0.9rem;
    color: #666;
    font-style: italic;
    margin: 0;
  }
  
  @media (max-width: 600px) {
    .config-grid {
      grid-template-columns: 1fr;
    }
    
    .severity-grid {
      flex-direction: column;
      align-items: center;
    }
  }
</style>
