import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

// Mock driver database - In production, replace with MongoDB
let drivers: Record<string, any> = {
  'john-truck-001': {
    id: 'john-truck-001',
    name: 'John Smith',
    vehicleId: 'TRUCK-001',
    status: 'active',
    lastSeen: Date.now() - 30000, // 30 seconds ago
    alertCount: 3,
    location: 'Warehouse District A',
    shift: 'Morning',
    startTime: Date.now() - 4 * 60 * 60 * 1000 // 4 hours ago
  },
  'maria-truck-002': {
    id: 'maria-truck-002',
    name: 'Maria Garcia',
    vehicleId: 'TRUCK-002',
    status: 'alert',
    lastSeen: Date.now() - 120000, // 2 minutes ago
    alertCount: 1,
    location: 'Loading Dock B',
    shift: 'Morning',
    startTime: Date.now() - 3.5 * 60 * 60 * 1000
  },
  'david-forklift-003': {
    id: 'david-forklift-003',
    name: 'David Chen',
    vehicleId: 'FORKLIFT-003',
    status: 'critical',
    lastSeen: Date.now() - 60000, // 1 minute ago
    alertCount: 5,
    location: 'Storage Area C',
    shift: 'Morning',
    startTime: Date.now() - 2 * 60 * 60 * 1000
  }
};

export const GET: RequestHandler = async ({ url }) => {
  try {
    const status = url.searchParams.get('status');
    const shift = url.searchParams.get('shift');
    
    let filteredDrivers = { ...drivers };
    
    if (status && status !== 'all') {
      filteredDrivers = Object.fromEntries(
        Object.entries(filteredDrivers).filter(([_, driver]) => driver.status === status)
      );
    }
    
    if (shift && shift !== 'all') {
      filteredDrivers = Object.fromEntries(
        Object.entries(filteredDrivers).filter(([_, driver]) => driver.shift === shift)
      );
    }
    
    // Update driver statuses based on last seen time
    Object.values(filteredDrivers).forEach(driver => {
      const timeSinceLastSeen = Date.now() - driver.lastSeen;
      
      if (timeSinceLastSeen > 5 * 60 * 1000) { // 5 minutes
        driver.status = 'inactive';
      }
    });
    
    return json(filteredDrivers);
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return json({ error: 'Failed to fetch drivers' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const driverData = await request.json();
    
    const driverId = driverData.id || `${driverData.name.toLowerCase().replace(' ', '-')}-${driverData.vehicleId.toLowerCase()}`;
    
    drivers[driverId] = {
      id: driverId,
      name: driverData.name,
      vehicleId: driverData.vehicleId,
      status: driverData.status || 'active',
      lastSeen: Date.now(),
      alertCount: driverData.alertCount || 0,
      location: driverData.location || 'Unknown',
      shift: driverData.shift || 'Unknown',
      startTime: driverData.startTime || Date.now()
    };
    
    return json({ success: true, driver: drivers[driverId] });
  } catch (error) {
    console.error('Error updating driver:', error);
    return json({ error: 'Failed to update driver' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const { driverId, updates } = await request.json();
    
    if (drivers[driverId]) {
      drivers[driverId] = {
        ...drivers[driverId],
        ...updates,
        lastSeen: Date.now()
      };
      
      return json({ success: true, driver: drivers[driverId] });
    } else {
      return json({ error: 'Driver not found' }, { status: 404 });
    }
  } catch (error) {
    console.error('Error updating driver:', error);
    return json({ error: 'Failed to update driver' }, { status: 500 });
  }
};
