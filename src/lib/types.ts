// src/lib/types.ts
export interface FatigueAlert {
  id: string;
  timestamp: number;
  driverName: string;
  vehicleId: string;
  alertType: 'drowsiness' | 'distraction' | 'yawning' | 'eyesClosed' | 'headDown' | 'lookingAway' | 'headTilted' | 'noFaceDetected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  imageDataUrl?: string; // Optional screenshot as data URL
  location?: { lat: number; lng: number };
  synced: boolean;
  acknowledged: boolean;
}

export interface DriverProfile {
  id: string;
  name: string;
  vehicleId: string;
  shiftStart: number;
  shiftEnd: number;
  photo?: string;
}

export interface VehicleInfo {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'maintenance' | 'inactive';
}