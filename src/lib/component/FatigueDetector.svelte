<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as faceapi from 'face-api.js';
  import { browser } from '$app/environment';
  import { addAlert } from '$lib/storage';
  import { v4 as uuidv4 } from 'uuid';
  import type { FatigueAlert } from '$lib/storage';
    export let driverName = 'Test Driver';
  export let vehicleId = 'V001';
  export let scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance' = 'workplace_fatigue';
  
  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let detectionInterval: number;
  let modelsLoaded = false;
  let stream: MediaStream | null = null;
  let eyeClosedDuration = 0;
  let lastBlinkTime = Date.now();
  let isFaceDetected = false;
  let headDownDuration = 0;
  let lookingAwayDuration = 0;
  let lastYawnTime = 0;
  let lastHeadDownTime = 0;
  let noFaceDetectedDuration = 0;
    // Detection thresholds - optimized for TinyFaceDetector
  const EYE_CLOSED_THRESHOLD = 0.15; // Lower threshold for better eye closure detection
  const DROWSINESS_THRESHOLD = 1500; // 1.5 seconds with eyes closed
  const HEAD_DOWN_THRESHOLD = 1000; // 1 second looking down
  const LOOKING_AWAY_THRESHOLD = 2000; // 2 seconds looking away
  const NO_FACE_THRESHOLD = 3000; // 3 seconds without face detection (reduced for TinyFace)
  const YAWN_COOLDOWN = 3000; // 3 seconds between yawn detections
  const HEAD_DOWN_COOLDOWN = 4000; // 4 seconds between head down detections
  
  // Head pose thresholds (in degrees) - more sensitive
  const HEAD_DOWN_PITCH_THRESHOLD = 15; // More sensitive looking down threshold
  const HEAD_UP_PITCH_THRESHOLD = -10; // Looking up threshold
  const HEAD_TILT_ROLL_THRESHOLD = 25; // More sensitive head tilt threshold
  const LOOKING_AWAY_YAW_THRESHOLD = 25; // More sensitive looking left/right threshold
  
 async function loadModels(): Promise<void> {
    if (!browser) return;
    
    try {
      console.log('Starting to load face-api.js models...');
      
      // Use the base URL for the models
      const modelPath = '/models';
        console.log(`Loading models from ${modelPath}`);      await faceapi.nets.tinyFaceDetector.load(modelPath);
      console.log('Tiny Face Detector model loaded');
      
      await faceapi.nets.faceLandmark68Net.load(modelPath);
      console.log('Face landmark model loaded');
      
      await faceapi.nets.faceExpressionNet.load(modelPath);
      console.log('Face expression model loaded');
      
      modelsLoaded = true;
      console.log('All face-api models loaded successfully');
    } catch (error) {
      console.error('Error loading models:', error);
      if (typeof error === 'object' && error !== null && 'message' in error) {
        console.error('Model loading failed with error:', (error as { message: string }).message);
      } else {
        console.error('Model loading failed with error:', error);
      }
      if (typeof error === 'object' && error !== null && 'stack' in error) {
        console.error('Stack trace:', (error as { stack: string }).stack);
      }
    }
  }
  
  async function startVideo(): Promise<void> {
   if (!browser || !video) return;
    
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
      };
    } catch (error) {
      console.error('Error accessing camera:', error);
    }
  }
    function calculateEAR(landmarks: faceapi.FaceLandmarks68): number {
    // Enhanced Eye Aspect Ratio calculation
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();
    
    // Left eye EAR calculation - using multiple points for better accuracy
    const leftEyeVertical1 = distance(leftEye[1], leftEye[5]);
    const leftEyeVertical2 = distance(leftEye[2], leftEye[4]);
    const leftEyeHorizontal = distance(leftEye[0], leftEye[3]);
    const leftEAR = (leftEyeVertical1 + leftEyeVertical2) / (2.0 * leftEyeHorizontal);
    
    // Right eye EAR calculation - using multiple points for better accuracy
    const rightEyeVertical1 = distance(rightEye[1], rightEye[5]);
    const rightEyeVertical2 = distance(rightEye[2], rightEye[4]);
    const rightEyeHorizontal = distance(rightEye[0], rightEye[3]);
    const rightEAR = (rightEyeVertical1 + rightEyeVertical2) / (2.0 * rightEyeHorizontal);
    
    // Return average EAR
    return (leftEAR + rightEAR) / 2;
  }
  
  function distance(pt1: faceapi.Point, pt2: faceapi.Point): number {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  }
  
  function calculateHeadPose(landmarks: faceapi.FaceLandmarks68): { pitch: number; yaw: number; roll: number } {
    // Get key facial landmarks for better head pose estimation
    const noseTip = landmarks.getNose()[3]; // Nose tip
    const noseBridge = landmarks.getNose()[0]; // Nose bridge top
    const leftEyeCenter = landmarks.getLeftEye()[3]; // Left eye center
    const rightEyeCenter = landmarks.getRightEye()[3]; // Right eye center
    const leftMouth = landmarks.getMouth()[0]; // Left mouth corner
    const rightMouth = landmarks.getMouth()[6]; // Right mouth corner
    const chin = landmarks.getJawOutline()[8]; // Chin point
    const forehead = landmarks.getJawOutline()[0]; // Approximated forehead point
    
    // Calculate roll (head tilt left/right) - improved calculation
    const eyeVector = { x: rightEyeCenter.x - leftEyeCenter.x, y: rightEyeCenter.y - leftEyeCenter.y };
    const roll = Math.atan2(eyeVector.y, eyeVector.x) * (180 / Math.PI);
    
    // Calculate pitch (head up/down) - improved with better reference points
    const eyeCenterY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
    const faceHeight = Math.abs(chin.y - eyeCenterY);
    const noseToEyeRatio = Math.abs(noseTip.y - eyeCenterY) / faceHeight;
    
    // More sensitive pitch calculation
    let pitch = 0;
    if (noseToEyeRatio > 0.3) {
      pitch = (noseToEyeRatio - 0.3) * 100; // Looking down
    } else if (noseToEyeRatio < 0.1) {
      pitch = -(0.1 - noseToEyeRatio) * 100; // Looking up
    }
    
    // Calculate yaw (head left/right) - improved calculation
    const noseCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
    const noseOffset = noseTip.x - noseCenterX;
    const faceWidth = Math.abs(rightEyeCenter.x - leftEyeCenter.x);
    const yaw = (noseOffset / faceWidth) * 60;
    
    return { pitch, yaw, roll };
  }
  
  function getSeverityForScenario(alertType: string, scenario: string): 'low' | 'medium' | 'high' | 'critical' {
    const severityMap: Record<string, Record<string, 'low' | 'medium' | 'high' | 'critical'>> = {
      workplace_fatigue: {
        drowsiness: 'high',
        eyesClosed: 'medium',
        headDown: 'low',
        yawning: 'medium',
        noFaceDetected: 'low'
      },
      driving_distraction: {
        drowsiness: 'critical',
        eyesClosed: 'critical',
        headDown: 'high',
        yawning: 'high',
        lookingAway: 'high',
        noFaceDetected: 'medium'
      },
      attention_monitoring: {
        drowsiness: 'high',
        eyesClosed: 'high',
        headDown: 'medium',
        yawning: 'low',
        lookingAway: 'medium',
        noFaceDetected: 'high'
      },
      safety_compliance: {
        drowsiness: 'critical',
        eyesClosed: 'high',
        headDown: 'medium',
        yawning: 'medium',
        lookingAway: 'high',
        noFaceDetected: 'high'
      }
    };
    
    return severityMap[scenario]?.[alertType] || 'medium';
  }
    async function createAlert(
    alertType: FatigueAlert['alertType'], 
    confidence: number = 1.0, 
    duration: number = 0
  ): Promise<void> {
    const screenshot = await captureScreenshot();
    
    const alert: FatigueAlert = {
      id: uuidv4(),
      timestamp: Date.now(),
      driverName,
      vehicleId,
      alertType,
      severity: getSeverityForScenario(alertType, scenario),
      imageDataUrl: screenshot || undefined,
      synced: false,
      acknowledged: false,
      scenario,
      duration,
      confidence
    };
    
    // Save to local storage
    await addAlert(alert);
    
    // Send to admin dashboard API
    try {
      const response = await fetch('/api/admin/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(alert)
      });
      
      if (response.ok) {
        // Mark as synced if successfully sent to admin
        alert.synced = true;
        await addAlert(alert); // Update with synced status
      }
    } catch (error) {
      console.error('Failed to send alert to admin dashboard:', error);
      // Alert will remain unsynced and can be retried later
    }
    
    // Update driver status in admin system
    try {
      await fetch('/api/admin/drivers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          driverId: `${driverName.toLowerCase().replace(' ', '-')}-${vehicleId.toLowerCase()}`,
          updates: {
            name: driverName,
            vehicleId: vehicleId,
            status: alert.severity === 'critical' ? 'critical' : 'alert',
            lastSeen: Date.now(),
            scenario: scenario
          }
        })
      });
    } catch (error) {
      console.error('Failed to update driver status:', error);
    }
    
    // Dispatch event for UI update
    if (browser) {
      const event = new CustomEvent('fatigue-alert', { detail: alert });
      window.dispatchEvent(event);
    }
    
    console.log(`Alert created: ${alertType} (${alert.severity}) - Scenario: ${scenario}`);
  }
  
  async function captureScreenshot(): Promise<string | null> {
    if (!canvas || !video) return null;
    
    const context = canvas.getContext('2d');
    if (!context) return null;
    
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5); // compressed JPEG
  }
    async function detectFatigue(): Promise<void> {
    if (!modelsLoaded || !video || !canvas) return;
    
    try {      const detections = await faceapi.detectAllFaces(
        video, 
        new faceapi.TinyFaceDetectorOptions({
          // Lower threshold for better detection performance
          scoreThreshold: 0.3,
          inputSize: 416 // Smaller input size for faster processing
        })
      ).withFaceLandmarks().withFaceExpressions();
      
      const displaySize = { width: video.width, height: video.height };
      faceapi.matchDimensions(canvas, displaySize);
      
      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      
      const context = canvas.getContext('2d');
      if (!context) return;
      
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const currentTime = Date.now();
      
      if (resizedDetections.length > 0) {
        isFaceDetected = true;
        noFaceDetectedDuration = 0; // Reset no face duration
        
        const detection = resizedDetections[0];
        const landmarks = detection.landmarks;
        const expressions = detection.expressions;
        const confidence = detection.detection.score;
        
        // Draw landmarks and detection box
        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
        
        // Calculate metrics
        const ear = calculateEAR(landmarks);
        const headPose = calculateHeadPose(landmarks);
          // 1. EYES CLOSED DETECTION - Enhanced
        if (ear < EYE_CLOSED_THRESHOLD) {
          if (eyeClosedDuration === 0) {
            eyeClosedDuration = currentTime;
          } else {
            const eyesClosedTime = currentTime - eyeClosedDuration;
            
            // Immediate eyes closed alert (for workplace monitoring)
            if (eyesClosedTime > 300 && scenario === 'workplace_fatigue') {
              await createAlert('eyesClosed', confidence, eyesClosedTime);
              eyeClosedDuration = currentTime; // Reset to avoid spam
            }
            
            // Drowsiness detection (extended eyes closed)
            if (eyesClosedTime > DROWSINESS_THRESHOLD) {
              await createAlert('drowsiness', confidence, eyesClosedTime);
              eyeClosedDuration = 0; // Reset after alert
            }
          }
        } else {
          eyeClosedDuration = 0;
        }
        
        // 2. HEAD POSITION DETECTION - Enhanced for up/down
        // Head down detection
        if (headPose.pitch > HEAD_DOWN_PITCH_THRESHOLD) {
          if (headDownDuration === 0) {
            headDownDuration = currentTime;
          } else if (currentTime - headDownDuration > HEAD_DOWN_THRESHOLD) {
            // Only create alert if enough time has passed since last head down alert
            if (currentTime - lastHeadDownTime > HEAD_DOWN_COOLDOWN) {
              await createAlert('headDown', confidence, currentTime - headDownDuration);
              lastHeadDownTime = currentTime;
            }
            headDownDuration = 0; // Reset duration
          }
        } else {
          headDownDuration = 0;
        }
        
        // Head up detection (looking at ceiling)
        if (headPose.pitch < HEAD_UP_PITCH_THRESHOLD) {
          await createAlert('headTilted', confidence, 0);
        }
        
        // 3. LOOKING AWAY DETECTION
        if (Math.abs(headPose.yaw) > LOOKING_AWAY_YAW_THRESHOLD) {
          if (lookingAwayDuration === 0) {
            lookingAwayDuration = currentTime;
          } else if (currentTime - lookingAwayDuration > LOOKING_AWAY_THRESHOLD) {
            await createAlert('lookingAway', confidence, currentTime - lookingAwayDuration);
            lookingAwayDuration = 0; // Reset after alert
          }
        } else {
          lookingAwayDuration = 0;
        }
        
        // 4. HEAD TILT DETECTION
        if (Math.abs(headPose.roll) > HEAD_TILT_ROLL_THRESHOLD) {
          await createAlert('headTilted', confidence, 0);
        }
        
        // 5. YAWNING DETECTION
        // Enhanced yawning detection using multiple expression indicators
        const mouthOpen = expressions.surprised > 0.6 || expressions.fearful > 0.4;
        const eyesPartiallyOpen = ear > EYE_CLOSED_THRESHOLD && ear < 0.3;
        
        if (mouthOpen && eyesPartiallyOpen && currentTime - lastYawnTime > YAWN_COOLDOWN) {
          await createAlert('yawning', confidence, 0);
          lastYawnTime = currentTime;
        }
        
        // 6. DISTRACTION DETECTION (composite)
        if (expressions.neutral < 0.3 && Math.abs(headPose.yaw) > 20) {
          await createAlert('distraction', confidence, 0);
        }
          // Draw head pose information on canvas with better debugging
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(10, 10, 250, 130);
        context.fillStyle = 'white';
        context.font = '12px Arial';
        context.fillText(`Pitch: ${headPose.pitch.toFixed(1)}° (${headPose.pitch > HEAD_DOWN_PITCH_THRESHOLD ? 'DOWN' : headPose.pitch < HEAD_UP_PITCH_THRESHOLD ? 'UP' : 'OK'})`, 15, 25);
        context.fillText(`Yaw: ${headPose.yaw.toFixed(1)}° (${Math.abs(headPose.yaw) > LOOKING_AWAY_YAW_THRESHOLD ? 'AWAY' : 'OK'})`, 15, 40);
        context.fillText(`Roll: ${headPose.roll.toFixed(1)}° (${Math.abs(headPose.roll) > HEAD_TILT_ROLL_THRESHOLD ? 'TILTED' : 'OK'})`, 15, 55);
        context.fillText(`EAR: ${ear.toFixed(3)} (${ear < EYE_CLOSED_THRESHOLD ? 'CLOSED' : 'OPEN'})`, 15, 70);
        context.fillText(`Confidence: ${(confidence * 100).toFixed(1)}%`, 15, 85);
        context.fillText(`Scenario: ${scenario}`, 15, 100);
        context.fillText(`Detection: TinyFace`, 15, 115);
        context.fillText(`FPS: ~${Math.round(1000 / 100)}`, 15, 130);
        
      } else {
        // NO FACE DETECTED
        isFaceDetected = false;
        
        if (noFaceDetectedDuration === 0) {
          noFaceDetectedDuration = currentTime;
        } else if (currentTime - noFaceDetectedDuration > NO_FACE_THRESHOLD) {
          await createAlert('noFaceDetected', 0, currentTime - noFaceDetectedDuration);
          noFaceDetectedDuration = currentTime; // Reset to avoid spam
        }
        
        // Reset all other durations when no face is detected
        eyeClosedDuration = 0;
        headDownDuration = 0;
        lookingAwayDuration = 0;
        
        // Draw "No Face Detected" message
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = 'rgba(255, 0, 0, 0.7)';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = 'white';
          context.font = '24px Arial';
          context.textAlign = 'center';
          context.fillText('NO FACE DETECTED', canvas.width / 2, canvas.height / 2);
          context.textAlign = 'left';
        }
      }
    } catch (error) {
      console.error('Error in face detection:', error);
    }
  }
  
  onMount(async () => {
    if (!browser) return;
    
    await loadModels();
    if (modelsLoaded) {
      await startVideo();
      
      detectionInterval = window.setInterval(detectFatigue, 150); // Run detection ~6.7 times per second for better performance
    }
  });
  
  onDestroy(() => {
    if (browser && detectionInterval) {
      window.clearInterval(detectionInterval);
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  });
</script>

<div class="fatigue-detector">
  <div class="video-container">
    <video bind:this={video} autoplay muted width="640" height="480" style="display: none;"></video>
    <canvas bind:this={canvas} width="640" height="480"></canvas>
  </div>
    <div class="status">
    <div class="status-item">
      <span class="label">Face Detection:</span>
      <span class="value {isFaceDetected ? 'active' : 'inactive'}">
        {isFaceDetected ? 'Active' : 'No Face Detected'}
      </span>
    </div>
    <div class="status-item">
      <span class="label">Models:</span>
      <span class="value {modelsLoaded ? 'active' : 'inactive'}">
        {modelsLoaded ? 'Loaded' : 'Loading...'}
      </span>
    </div>
    <div class="status-item">
      <span class="label">Scenario:</span>
      <span class="value scenario-{scenario}">
        {scenario.replace('_', ' ').toUpperCase()}
      </span>
    </div>
    <div class="status-item">
      <span class="label">Driver:</span>
      <span class="value neutral">
        {driverName}
      </span>
    </div>
  </div>
    <div class="detection-modes">
    <h3>Active Detection Modes (TinyFace):</h3>
    <div class="modes-grid">
      <div class="mode-item">👁️ Eyes Closed Detection (EAR &lt; 0.15)</div>
      <div class="mode-item">😴 Drowsiness Monitoring (1.5s+)</div>
      <div class="mode-item">👇 Head Down Detection (15°+)</div>
      <div class="mode-item">👆 Head Up Detection (-10°+)</div>
      <div class="mode-item">👈 Looking Away Detection (25°+)</div>
      <div class="mode-item">😵 Head Tilt Detection (25°+)</div>
      <div class="mode-item">🥱 Yawning Detection</div>
      <div class="mode-item">😕 Distraction Detection</div>
      <div class="mode-item">❌ No Face Detection</div>
    </div>
  </div>
</div>

<style>
  .fatigue-detector {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 2rem;
    font-family: Arial, sans-serif;
  }
  
  .video-container {
    position: relative;
    margin-bottom: 1rem;
    width: 640px;
    height: 480px;
    border: 2px solid #ddd;
    border-radius: 8px;
    overflow: hidden;
  }
  
  video, canvas {
    position: absolute;
    top: 0;
    left: 0;
    border-radius: 6px;
  }
  
  .status {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  
  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #f5f5f5;
    padding: 0.5rem;
    border-radius: 6px;
  }
  
  .label {
    font-weight: bold;
    font-size: 0.9rem;
  }
  
  .value {
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: bold;
  }
  
  .active {
    background-color: #4CAF50;
    color: white;
  }
  
  .inactive {
    background-color: #F44336;
    color: white;
  }
  
  .neutral {
    background-color: #2196F3;
    color: white;
  }
  
  .scenario-workplace_fatigue {
    background-color: #FF9800;
    color: white;
  }
  
  .scenario-driving_distraction {
    background-color: #E91E63;
    color: white;
  }
  
  .scenario-attention_monitoring {
    background-color: #9C27B0;
    color: white;
  }
  
  .scenario-safety_compliance {
    background-color: #607D8B;
    color: white;
  }
  
  .detection-modes {
    margin-top: 1rem;
    padding: 1rem;
    background: #f9f9f9;
    border-radius: 8px;
    max-width: 640px;
  }
  
  .detection-modes h3 {
    margin: 0 0 1rem 0;
    color: #333;
    text-align: center;
  }
  
  .modes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.5rem;
  }
  
  .mode-item {
    background: white;
    padding: 0.5rem;
    border-radius: 4px;
    text-align: center;
    font-size: 0.9rem;
    border: 1px solid #ddd;
  }
</style>