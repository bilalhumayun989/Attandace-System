# Biometric Kiosk Configuration
# CAMERA_SOURCE: 0 for Laptop Webcam, RTSP URL for Production
CAMERA_SOURCE = 0  # Default to laptop testing

# RTSP Format for Hikvision:
# rtsp://admin:PASSWORD@CAMERA_IP:554/Streaming/Channels/102 (Sub-stream)
RTSP_URL = "rtsp://admin:PASSWORD@192.168.1.64:554/Streaming/Channels/102"

# Recognition Settings (Industrial Grade)
# Recognition Settings (Industrial Grade)
MATCH_THRESHOLD = 0.45       # Base threshold
STRICT_THRESHOLD = 0.38      # High-confidence threshold
DETECTION_CONFIDENCE = 0.6
VALIDATION_FRAMES = 5        # Increased for temporal stability (approx 1 sec)
COOLDOWN_MINUTES = 5

# Liveness Detection (Anti-Spoofing)
LIVENESS_ENABLED = True
EYE_AR_THRESHOLD = 0.16      # Stricter blink (lower is harder)
POSE_YAW_THRESHOLD = 0.6     # Movement ratio for head turn
TEXTURE_THRESHOLD = 450      # Higher is more restrictive (rejects screens)
LIVENESS_FRAMES = 5          # Number of frames showing movement/blink needed
MOIRE_THRESHOLD = 15.0       # Threshold for digital noise detection


# Tracking Settings
MAX_DISAPPEARED = 10         # Frames to keep a face in memory after it leaves

# API Configuration
API_BASE_URL = "http://localhost:5000/api"


