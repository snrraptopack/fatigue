<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as faceapi from 'face-api.js';
  import { browser } from '$app/environment';
  import { addAlert } from '$lib/storage';
  import { v4 as uuidv4 } from 'uuid';
  import type { FatigueAlert } from '$lib/storage';
  export let driverName = '';
  export let vehicleId = '';
  export let scenario: 'workplace_fatigue' | 'driving_distraction' | 'attention_monitoring' | 'safety_compliance' = 'workplace_fatigue';

  // Modal state
  let showModal = true;
  let tempDriverName = '';
  let tempVehicleId = '';
  let formError = '';

  let video: HTMLVideoElement;
  let canvas: HTMLCanvasElement;
  let detectionInterval: number;
  let frameInterval: number;
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
  let cameraAccessFailed = false;
  let wsConnection: WebSocket | null = null;
  let lastFrameSent = 0;
  let driverId = '';

  // Detection thresholds - optimized for TinyFaceDetector
  const EYE_CLOSED_THRESHOLD = 0.18; // Slightly higher threshold to reduce false positives
  const DROWSINESS_THRESHOLD = 2000; // 2 seconds with eyes closed (increased for better accuracy)
  const HEAD_DOWN_THRESHOLD = 1500; // 1.5 seconds looking down
  const LOOKING_AWAY_THRESHOLD = 2500; // 2.5 seconds looking away
  const NO_FACE_THRESHOLD = 4000; // 4 seconds without face detection
  const YAWN_COOLDOWN = 5000; // 5 seconds between yawn detections (increased to reduce false positives)
  const HEAD_DOWN_COOLDOWN = 6000; // 6 seconds between head down detections

  // Head pose thresholds (in degrees) - more conservative
  const HEAD_DOWN_PITCH_THRESHOLD = 20; // Less sensitive looking down threshold
  const HEAD_UP_PITCH_THRESHOLD = -15; // Looking up threshold
  const HEAD_TILT_ROLL_THRESHOLD = 30; // Less sensitive head tilt threshold
  const LOOKING_AWAY_YAW_THRESHOLD = 30; // Less sensitive looking left/right threshold

  // Human presence detection
  let humanPresenceDetected = false;
  let lastHumanDetectionTime = 0;
  let humanPresenceThreshold = 1000; // 1 second to confirm human presence
  let noHumanThreshold = 2000; // 2 seconds to confirm no human

  // Function to handle form submission
  function handleFormSubmit() {
    if (!tempDriverName.trim()) {
      formError = 'Please enter your name';
      return;
    }

    if (!tempVehicleId.trim()) {
      formError = 'Please enter your vehicle ID';
      return;
    }

    // Set the driver name and vehicle ID
    driverName = tempDriverName;
    vehicleId = tempVehicleId;
    driverId = `${driverName.toLowerCase().replace(/\s+/g, '-')}-${vehicleId.toLowerCase()}`;

    showModal = false;

    initializeSystem();
  }

  // Function to initialize the system after driver info is entered
  async function initializeSystem() {
    if (!browser) return;

    await loadModels();
    if (modelsLoaded) {
      try {
        await startVideo();

        // Initialize WebSocket connection
        await initializeWebSocket();

        // Start detection
        detectionInterval = window.setInterval(detectFatigue, 150); // Run detection ~6.7 times per second for better performance
      } catch (error) {
        console.error('Failed to start video:', error);
        cameraAccessFailed = true;
      }
    }
  }

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
      // Add a timeout to the getUserMedia call
      const timeoutPromise = new Promise<MediaStream>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout starting video source')), 10000);
      });

      // Race the getUserMedia call with the timeout
      stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true }),
        timeoutPromise
      ]);

      video.srcObject = stream;

      // Return a promise that resolves when the video is ready to play
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Timeout waiting for video to load'));
        }, 5000);

        video.onloadedmetadata = () => {
          clearTimeout(timeoutId);
          video.play()
            .then(() => resolve())
            .catch(err => reject(err));
        };
      });

      console.log('Video started successfully');
    } catch (error) {
      console.error('Error accessing camera:', error);
      // Set a flag to indicate that camera access failed
      cameraAccessFailed = true;

      // Try to recover by showing a placeholder or error message
      if (canvas) {
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = 'black';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = 'white';
          context.font = '20px Arial';
          context.textAlign = 'center';
          context.fillText('Camera access failed. Please check permissions.', canvas.width / 2, canvas.height / 2);
          context.textAlign = 'left';
        }
      }

      // Throw the error so the caller can handle it
      throw error;
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
        yawning: 'low',
        lookingAway: 'medium',
        noFaceDetected: 'low',
        distraction: 'medium'
      },
      driving_distraction: {
        drowsiness: 'critical',
        eyesClosed: 'critical',
        headDown: 'high',
        yawning: 'medium',
        lookingAway: 'high',
        noFaceDetected: 'medium',
        distraction: 'high'
      },
      attention_monitoring: {
        drowsiness: 'high',
        eyesClosed: 'high',
        headDown: 'medium',
        yawning: 'low',
        lookingAway: 'medium',
        noFaceDetected: 'high',
        distraction: 'medium'
      },
      safety_compliance: {
        drowsiness: 'critical',
        eyesClosed: 'high',
        headDown: 'medium',
        yawning: 'low',
        lookingAway: 'high',
        noFaceDetected: 'high',
        distraction: 'high'
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
    if (!modelsLoaded || !canvas) return;
    if (!video || video.readyState < 2 || cameraAccessFailed) {
      // Video is not ready or camera access failed
      if (canvas) {
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = 'black';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = 'white';
          context.font = '20px Arial';
          context.textAlign = 'center';
          context.fillText('Camera not ready or access denied', canvas.width / 2, canvas.height / 2);
          context.textAlign = 'left';
        }
      }
      return;
    }

    try {
      // Check if video dimensions are valid
      if (!video.videoWidth || !video.videoHeight) {
        console.log('Video dimensions not available yet');
        return;
      }

      const detections = await faceapi.detectAllFaces(
        video, 
        new faceapi.TinyFaceDetectorOptions({
          // Lower threshold for better detection performance
          scoreThreshold: 0.3,
          inputSize: 416 // Smaller input size for faster processing
        })
      ).withFaceLandmarks().withFaceExpressions();

      const displaySize = { width: video.videoWidth, height: video.videoHeight };
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

        // Update human presence detection
        if (!humanPresenceDetected) {
          if (lastHumanDetectionTime === 0) {
            lastHumanDetectionTime = currentTime;
          } else if (currentTime - lastHumanDetectionTime > humanPresenceThreshold) {
            humanPresenceDetected = true;
            console.log('Human presence confirmed');
          }
        }

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
            if (eyesClosedTime > 500 && scenario === 'workplace_fatigue') {
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

        // 3. LOOKING AWAY DETECTION - Only if human is present
        if (humanPresenceDetected && Math.abs(headPose.yaw) > LOOKING_AWAY_YAW_THRESHOLD) {
          if (lookingAwayDuration === 0) {
            lookingAwayDuration = currentTime;
          } else if (currentTime - lookingAwayDuration > LOOKING_AWAY_THRESHOLD) {
            await createAlert('lookingAway', confidence, currentTime - lookingAwayDuration);
            lookingAwayDuration = 0;
          }
        } else {
          lookingAwayDuration = 0;
        }

        // 4. HEAD TILT DETECTION
        if (Math.abs(headPose.roll) > HEAD_TILT_ROLL_THRESHOLD) {
          await createAlert('headTilted', confidence, 0);
        }

        // 5. YAWNING DETECTION - Improved algorithm
        // More sophisticated yawning detection using multiple indicators
        const mouthOpenness = expressions.surprised + expressions.fearful;
        const eyesPartiallyOpen = ear > EYE_CLOSED_THRESHOLD && ear < 0.25;
        const neutralExpression = expressions.neutral;
        
        // Yawning is characterized by open mouth, partially closed eyes, and reduced neutral expression
        const isYawning = mouthOpenness > 0.7 && 
                         eyesPartiallyOpen && 
                         neutralExpression < 0.4 &&
                         currentTime - lastYawnTime > YAWN_COOLDOWN;

        if (isYawning) {
          await createAlert('yawning', confidence, 0);
          lastYawnTime = currentTime;
        }

        // 6. DISTRACTION DETECTION (composite) - Only if human is present
        if (humanPresenceDetected && expressions.neutral < 0.3 && Math.abs(headPose.yaw) > 20) {
          await createAlert('distraction', confidence, 0);
        }

        // Draw head pose information on canvas with better debugging
        context.fillStyle = 'rgba(0, 0, 0, 0.7)';
        context.fillRect(10, 10, 280, 150);
        context.fillStyle = 'white';
        context.font = '12px Arial';
        context.fillText(`Pitch: ${headPose.pitch.toFixed(1)}° (${headPose.pitch > HEAD_DOWN_PITCH_THRESHOLD ? 'DOWN' : headPose.pitch < HEAD_UP_PITCH_THRESHOLD ? 'UP' : 'OK'})`, 15, 25);
        context.fillText(`Yaw: ${headPose.yaw.toFixed(1)}° (${Math.abs(headPose.yaw) > LOOKING_AWAY_YAW_THRESHOLD ? 'AWAY' : 'OK'})`, 15, 40);
        context.fillText(`Roll: ${headPose.roll.toFixed(1)}° (${Math.abs(headPose.roll) > HEAD_TILT_ROLL_THRESHOLD ? 'TILTED' : 'OK'})`, 15, 55);
        context.fillText(`EAR: ${ear.toFixed(3)} (${ear < EYE_CLOSED_THRESHOLD ? 'CLOSED' : 'OPEN'})`, 15, 70);
        context.fillText(`Confidence: ${(confidence * 100).toFixed(1)}%`, 15, 85);
        context.fillText(`Scenario: ${scenario}`, 15, 100);
        context.fillText(`Human: ${humanPresenceDetected ? 'PRESENT' : 'DETECTING'}`, 15, 115);
        context.fillText(`Mouth: ${mouthOpenness.toFixed(2)}`, 15, 130);
        context.fillText(`Neutral: ${neutralExpression.toFixed(2)}`, 15, 145);

      } else {
        // NO FACE DETECTED
        isFaceDetected = false;

        // Update human presence detection
        if (humanPresenceDetected) {
          if (lastHumanDetectionTime === 0) {
            lastHumanDetectionTime = currentTime;
          } else if (currentTime - lastHumanDetectionTime > noHumanThreshold) {
            humanPresenceDetected = false;
            lastHumanDetectionTime = 0;
            console.log('Human presence lost');
          }
        }

        if (noFaceDetectedDuration === 0) {
          noFaceDetectedDuration = currentTime;
        } else if (currentTime - noFaceDetectedDuration > NO_FACE_THRESHOLD) {
          // Only create alert if human was previously detected (distinguishes from no human present)
          if (humanPresenceDetected) {
            await createAlert('noFaceDetected', 0, currentTime - noFaceDetectedDuration);
          }
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
          context.fillText('NO FACE DETECTED', canvas.width / 2, canvas.height / 2 - 20);
          context.fillText(humanPresenceDetected ? 'HUMAN PRESENT - LOOKING AWAY' : 'NO HUMAN DETECTED', canvas.width / 2, canvas.height / 2 + 20);
          context.textAlign = 'left';
        }
      }
    } catch (error) {
      console.error('Error in face detection:', error);
    }
  }

  // Initialize WebSocket connection for real-time monitoring
  async function initializeWebSocket() {
    if (!browser) return;

    try {
      // Close existing connection if any
      if (wsConnection && wsConnection.readyState !== 3) { // 3 = CLOSED in WebSocket standard
          wsConnection.close();
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws`;

      wsConnection = new WebSocket(wsUrl);

      wsConnection.onopen = () => {
        console.log('WebSocket connection established');

        // Register as a driver
        wsConnection?.send(JSON.stringify({
          type: 'register',
          driverId,
          driverName,
          vehicleId
        }));

        // Start sending frames
        startSendingFrames();
      };

      wsConnection.onclose = () => {
        console.log('WebSocket connection closed');

        // Try to reconnect after a delay
        setTimeout(initializeWebSocket, 5000);
      };

      wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      wsConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle different message types
          switch (data.type) {
            case 'stream_request':
              // Admin is requesting to start/stop streaming
              if (data.active) {
                startSendingFrames();
              } else {
                stopSendingFrames();
              }
              break;

            case 'scenario_change':
              // Admin is changing the scenario
              if (data.scenario) {
                scenario = data.scenario as any;
                console.log(`Scenario changed to: ${scenario}`);
              }
              break;

            case 'ping':
              // Respond to ping with pong
              wsConnection?.send(JSON.stringify({ type: 'pong' }));
              break;
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
    }
  }

  // Start sending frames to the server
  function startSendingFrames() {
    if (frameInterval) {
      clearInterval(frameInterval);
    }

    // Send frames every 500ms (2 frames per second)
    frameInterval = window.setInterval(sendFrame, 500);
  }

  // Stop sending frames to the server
  function stopSendingFrames() {
    if (frameInterval) {
      clearInterval(frameInterval);
      frameInterval = undefined;
    }
  }

  // Send a frame to the server
  async function sendFrame() {
    if (!wsConnection || wsConnection.readyState !== 1 || !video || !canvas || cameraAccessFailed) { // 1 = OPEN in WebSocket standard
      return;
    }

    // Limit to 2 frames per second
    const now = Date.now();
    if (now - lastFrameSent < 500) {
      return;
    }

    try {
      // Capture a frame
      const frame = await captureScreenshot();
      if (!frame) return;

      // Send the frame to the server
      wsConnection.send(JSON.stringify({
        type: 'video_frame',
        driverId,
        frame,
        timestamp: now
      }));

      lastFrameSent = now;
    } catch (error) {
      console.error('Failed to send frame:', error);
    }
  }

  onMount(async () => {
    if (!browser) return;

    // Only load models initially, don't start video or detection yet
    await loadModels();

    // If driver info is already provided (via props), initialize the system
    if (driverName && vehicleId) {
      driverId = `${driverName.toLowerCase().replace(/\s+/g, '-')}-${vehicleId.toLowerCase()}`;
      showModal = false;
      initializeSystem();
    }
  });

  onDestroy(() => {
    if (browser) {
      // Clear intervals
      if (detectionInterval) {
        window.clearInterval(detectionInterval);
        detectionInterval = undefined;
      }

      if (frameInterval) {
        window.clearInterval(frameInterval);
        frameInterval = undefined;
      }

      // Close WebSocket connection
      if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
      }

      // Stop camera stream
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
    }
  });
</script>

<div class="fatigue-detector">
  {#if showModal}
    <!-- Driver Information Modal -->
    <div class="modal-overlay">
      <div class="modal-content">
        <h2>Driver Information</h2>
        <p>Please enter your name and vehicle ID to begin fatigue monitoring.</p>

        <form on:submit|preventDefault={handleFormSubmit}>
          <div class="form-group">
            <label for="driverName">Driver Name</label>
            <input 
              type="text" 
              id="driverName" 
              bind:value={tempDriverName} 
              placeholder="Enter your full name"
              required
            />
          </div>

          <div class="form-group">
            <label for="vehicleId">Vehicle ID</label>
            <input 
              type="text" 
              id="vehicleId" 
              bind:value={tempVehicleId} 
              placeholder="Enter your vehicle ID"
              required
            />
          </div>

          {#if formError}
            <div class="error-message">{formError}</div>
          {/if}

          <button type="submit" class="submit-button">Start Monitoring</button>
        </form>
      </div>
    </div>
  {:else}
    <!-- Main Fatigue Detection UI -->
    <div class="header">
      <h1>Fatigue Monitoring System</h1>
      <div class="driver-info">
        <span class="driver-name">{driverName}</span>
        <span class="vehicle-id">{vehicleId}</span>
      </div>
    </div>

    <div class="video-container">
      <video bind:this={video} autoplay muted width="640" height="480" style="display: none;"></video>
      <canvas bind:this={canvas} width="640" height="480"></canvas>

      <!-- Status overlay -->
      <div class="status-overlay">
        <div class="status-badge {isFaceDetected ? 'active' : 'inactive'}">
          {isFaceDetected ? 'Face Detected' : 'No Face Detected'}
        </div>
      </div>
    </div>

    <div class="status-panel">
      <div class="status-row">
        <div class="status-item">
          <div class="status-icon">👁️</div>
          <div class="status-info">
            <span class="status-label">Face Detection</span>
            <span class="status-value {isFaceDetected ? 'active' : 'inactive'}">
              {isFaceDetected ? 'Active' : 'No Face'}
            </span>
          </div>
        </div>

        <div class="status-item">
          <div class="status-icon">🔄</div>
          <div class="status-info">
            <span class="status-label">Models</span>
            <span class="status-value {modelsLoaded ? 'active' : 'inactive'}">
              {modelsLoaded ? 'Loaded' : 'Loading...'}
            </span>
          </div>
        </div>

        <div class="status-item">
          <div class="status-icon">🚗</div>
          <div class="status-info">
            <span class="status-label">Vehicle</span>
            <span class="status-value neutral">
              {vehicleId}
            </span>
          </div>
        </div>
      </div>

      <div class="status-row">
        <div class="status-item scenario">
          <div class="status-icon">📊</div>
          <div class="status-info">
            <span class="status-label">Monitoring Mode</span>
            <span class="status-value scenario-{scenario}">
              {scenario.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          </div>
        </div>

        <div class="status-item connection">
          <div class="status-icon">🔌</div>
          <div class="status-info">
            <span class="status-label">Connection</span>
            <span class="status-value {wsConnection && wsConnection.readyState === 1 ? 'active' : 'inactive'}">
              {wsConnection && wsConnection.readyState === 1 ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="detection-panel">
      <h3>Active Detection Features</h3>
      <div class="detection-grid">
        <div class="detection-item">
          <div class="detection-icon">👁️</div>
          <div class="detection-label">Eyes Closed</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">😴</div>
          <div class="detection-label">Drowsiness</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">👇</div>
          <div class="detection-label">Head Down</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">👆</div>
          <div class="detection-label">Head Up</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">👈</div>
          <div class="detection-label">Looking Away</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">😵</div>
          <div class="detection-label">Head Tilt</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">🥱</div>
          <div class="detection-label">Yawning</div>
        </div>
        <div class="detection-item">
          <div class="detection-icon">😕</div>
          <div class="detection-label">Distraction</div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Global styles */
  .fatigue-detector {
    display: flex;
    flex-direction: column;
    align-items: center;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    color: #333;
  }

  /* Modal styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }

  .modal-content {
    background-color: white;
    border-radius: 12px;
    padding: 30px;
    width: 90%;
    max-width: 500px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  }

  .modal-content h2 {
    margin-top: 0;
    color: #2c3e50;
    font-size: 24px;
    text-align: center;
  }

  .modal-content p {
    margin-bottom: 20px;
    text-align: center;
    color: #7f8c8d;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 600;
    color: #2c3e50;
  }

  .form-group input {
    width: 100%;
    padding: 12px;
    border: 2px solid #ddd;
    border-radius: 8px;
    font-size: 16px;
    transition: border-color 0.3s;
  }

  .form-group input:focus {
    border-color: #3498db;
    outline: none;
  }

  .error-message {
    color: #e74c3c;
    margin-bottom: 15px;
    font-size: 14px;
    text-align: center;
  }

  .submit-button {
    background-color: #3498db;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 12px 20px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    transition: background-color 0.3s;
  }

  .submit-button:hover {
    background-color: #2980b9;
  }

  /* Header styles */
  .header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid #eee;
  }

  .header h1 {
    font-size: 24px;
    color: #2c3e50;
    margin: 0;
  }

  .driver-info {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .driver-name {
    font-weight: 600;
    font-size: 18px;
    color: #2c3e50;
  }

  .vehicle-id {
    font-size: 14px;
    color: #7f8c8d;
  }

  /* Video container styles */
  .video-container {
    position: relative;
    width: 100%;
    max-width: 640px;
    height: 480px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
    margin-bottom: 20px;
  }

  video, canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 12px;
  }

  .status-overlay {
    position: absolute;
    top: 15px;
    right: 15px;
    z-index: 10;
  }

  .status-badge {
    padding: 8px 12px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  }

  /* Status panel styles */
  .status-panel {
    width: 100%;
    max-width: 640px;
    background-color: #f8f9fa;
    border-radius: 12px;
    padding: 15px;
    margin-bottom: 20px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .status-row:last-child {
    margin-bottom: 0;
  }

  .status-item {
    display: flex;
    align-items: center;
    background-color: white;
    padding: 10px 15px;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    flex: 1;
    margin-right: 10px;
  }

  .status-item:last-child {
    margin-right: 0;
  }

  .status-icon {
    font-size: 24px;
    margin-right: 10px;
  }

  .status-info {
    display: flex;
    flex-direction: column;
  }

  .status-label {
    font-size: 12px;
    color: #7f8c8d;
    margin-bottom: 2px;
  }

  .status-value {
    font-size: 14px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    display: inline-block;
  }

  .status-item.scenario, .status-item.connection {
    flex: 1;
  }

  /* Detection panel styles */
  .detection-panel {
    width: 100%;
    max-width: 640px;
    background-color: white;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .detection-panel h3 {
    margin-top: 0;
    margin-bottom: 15px;
    color: #2c3e50;
    font-size: 18px;
    text-align: center;
  }

  .detection-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 15px;
  }

  .detection-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 15px 10px;
    background-color: #f8f9fa;
    border-radius: 8px;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .detection-item:hover {
    transform: translateY(-3px);
    box-shadow: 0 5px 10px rgba(0, 0, 0, 0.1);
  }

  .detection-icon {
    font-size: 24px;
    margin-bottom: 8px;
  }

  .detection-label {
    font-size: 12px;
    text-align: center;
    color: #2c3e50;
  }

  /* Status colors */
  .active {
    background-color: #2ecc71;
    color: white;
  }

  .inactive {
    background-color: #e74c3c;
    color: white;
  }

  .neutral {
    background-color: #3498db;
    color: white;
  }

  .scenario-workplace_fatigue {
    background-color: #f39c12;
    color: white;
  }

  .scenario-driving_distraction {
    background-color: #e74c3c;
    color: white;
  }

  .scenario-attention_monitoring {
    background-color: #9b59b6;
    color: white;
  }

  .scenario-safety_compliance {
    background-color: #34495e;
    color: white;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .detection-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .status-row {
      flex-direction: column;
    }

    .status-item {
      margin-right: 0;
      margin-bottom: 10px;
    }

    .status-item:last-child {
      margin-bottom: 0;
    }

    .header {
      flex-direction: column;
      align-items: flex-start;
    }

    .driver-info {
      align-items: flex-start;
      margin-top: 10px;
    }
  }
</style>
