# Fatigue Detection Testing Guide

## Quick Performance Test
1. **Start the application**: `npm run dev`
2. **Check console logs** for model loading messages
3. **Allow camera access** when prompted
4. **Look for the debug overlay** on the video feed

## TinyFaceDetector vs SSD Performance Comparison
- **TinyFaceDetector**: Faster, lower accuracy, better for real-time
- **SSD**: Slower, higher accuracy, may cause "No Face Detected" issues

## Testing Detection Features

### 1. Eye Closure Detection
- **Test**: Close your eyes for 1-2 seconds
- **Expected**: Should trigger "eyesClosed" alert quickly
- **Debug**: Watch EAR value in overlay (should drop below 0.15)

### 2. Head Position Detection
- **Head Down**: Look down at your desk/keyboard
- **Head Up**: Look up at the ceiling
- **Looking Away**: Turn head left or right
- **Head Tilt**: Tilt head to shoulder

### 3. Debugging Information
The video overlay now shows:
- **Pitch**: Up/down head movement (-10° to +15° thresholds)
- **Yaw**: Left/right head movement (±25° threshold)
- **Roll**: Head tilt (±25° threshold)
- **EAR**: Eye aspect ratio (0.15 threshold)
- **Confidence**: Face detection confidence
- **Detection Status**: OK/CLOSED/DOWN/UP/AWAY/TILTED

## Troubleshooting "No Face Detected"

### If you still get frequent "No Face Detected":
1. **Check lighting** - TinyFace needs good lighting
2. **Camera quality** - Lower quality cameras struggle more
3. **Distance from camera** - Stay 2-3 feet from camera
4. **Reduce detection frequency** - Change from 150ms to 200ms in code

### Performance Improvements Made:
- Switched to TinyFaceDetector (faster)
- Reduced detection frequency to 150ms
- Lowered face detection threshold to 0.3
- Optimized EAR calculation with multiple points
- Improved head pose calculation
- Added debugging overlay

## Expected Behavior by Scenario
- **Workplace Fatigue**: Quick eye closure alerts
- **Driving Distraction**: Critical alerts for all events
- **Attention Monitoring**: Focus on looking away
- **Safety Compliance**: Comprehensive monitoring

## Performance Tuning Options
If still having issues, try these in FatigueDetector.svelte:
1. Increase detection interval: `150` → `200` or `250`
2. Lower face detection threshold: `0.3` → `0.2`
3. Smaller input size: `416` → `320` or `224`
