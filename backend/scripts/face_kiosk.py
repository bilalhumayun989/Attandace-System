# pyrefly: ignore [missing-import]
import cv2
# pyrefly: ignore [missing-import]
import face_recognition
import numpy as np
import requests
import time
from datetime import datetime
import config
from scipy.spatial import distance as dist

# --- Global State ---
user_cooldowns = {}
user_names = {}
tracked_faces = {} 

def calculate_ear(eye):
    A = dist.euclidean(eye[1], eye[5])
    B = dist.euclidean(eye[2], eye[4])
    C = dist.euclidean(eye[0], eye[3])
    ear = (A + B) / (2.0 * C)
    return ear

def get_face_yaw(landmarks):
    left_eye = np.mean(landmarks['left_eye'], axis=0)
    right_eye = np.mean(landmarks['right_eye'], axis=0)
    nose_tip = landmarks['nose_bridge'][-1]
    dist_l = dist.euclidean(nose_tip, left_eye)
    dist_r = dist.euclidean(nose_tip, right_eye)
    return dist_l / dist_r

def check_texture(frame, top, right, bottom, left):
    """Detect if the surface is a digital screen or photo using Laplacian Variance and Moiré analysis."""
    face_img = frame[top:bottom, left:right]
    if face_img.size == 0: return 0, 0
    
    gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
    
    # 1. Laplacian variance (Sharpness/Texture depth)
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # 2. Moiré Pattern Detection (High-frequency noise from screens)
    # Screens have periodic patterns that real skin lacks
    dft = cv2.dft(np.float32(gray), flags=cv2.DFT_COMPLEX_OUTPUT)
    dft_shift = np.fft.fftshift(dft)
    magnitude_spectrum = 20 * np.log(cv2.magnitude(dft_shift[:, :, 0], dft_shift[:, :, 1]) + 1)
    
    # Analyze the high-frequency components
    moire_score = np.mean(magnitude_spectrum)
    
    return variance, moire_score

def get_employees():
    try:
        response = requests.get(f"{config.API_BASE_URL}/attendance/face-descriptors")
        if response.status_code == 200:
            data = response.json()
            employees = data.get('employees', [])
            known_encodings, known_ids = [], []
            for emp in employees:
                user_names[emp['_id']] = emp['name']
                for desc in emp['faceDescriptors']:
                    known_encodings.append(np.array(desc))
                    known_ids.append(emp['_id'])
            return known_encodings, known_ids
    except Exception as e:
        print(f"❌ Error fetching employees: {e}")
    return [], []

def mark_attendance(user_id):
    try:
        url = f"{config.API_BASE_URL}/attendance/face-checkin"
        payload = {"userId": user_id, "timestamp": datetime.now().isoformat()}
        response = requests.post(url, json=payload)
        if response.status_code == 200: return response.json()
    except Exception as e: print(f"❌ API Error: {e}")
    return None

def connect_camera():
    source = 0 if config.CAMERA_SOURCE == 0 else config.RTSP_URL
    cap = cv2.VideoCapture(source)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap, source

def main():
    print("--- [ZERO-SPOOF] Biometric Kiosk ---")
    known_encodings, known_ids = get_employees()
    if not known_encodings: return

    cap, source = connect_camera()
    if not cap.isOpened(): return

    next_cleanup = time.time() + 30

    while True:
        ret, frame = cap.read()
        if not ret:
            cap.release()
            time.sleep(2)
            cap, source = connect_camera()
            continue

        # Process at 0.25x for speed, but check texture on full resolution
        small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
        rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

        face_locations = face_recognition.face_locations(rgb_small_frame, model="hog")
        face_landmarks_list = face_recognition.face_landmarks(rgb_small_frame, face_locations)
        face_encodings = face_recognition.face_encodings(rgb_small_frame, face_locations)

        for (top, right, bottom, left), face_landmarks, face_encoding in zip(face_locations, face_landmarks_list, face_encodings):
            # Scale coordinates back to original frame
            o_top, o_right, o_bottom, o_left = top*4, right*4, bottom*4, left*4
            center = ( (o_left + o_right) // 2, (o_top + o_bottom) // 2 )
            
            # Tracking
            matched_id = None
            for fid, data in tracked_faces.items():
                if dist.euclidean(center, data["center"]) < 80:
                    matched_id = fid
                    break
            
            if not matched_id:
                matched_id = f"face_{int(time.time() * 1000)}"
                tracked_faces[matched_id] = {
                    "center": center, "label": "unknown", "frames": 0, 
                    "yaw_history": [], "texture_history": [],
                    "blinked": False, "turned": False, "textured": False,
                    "live": False, "marked": False, "last_seen": time.time()
                }
            
            face_data = tracked_faces[matched_id]
            face_data["center"] = center
            face_data["last_seen"] = time.time()

            # --- 1. TEXTURE & MOIRE ANALYSIS (Anti-Screen) ---
            if not face_data["textured"]:
                var, moire = check_texture(frame, o_top, o_right, o_bottom, o_left)
                face_data["texture_history"].append(var)
                if len(face_data["texture_history"]) > 10: face_data["texture_history"].pop(0)
                
                avg_var = np.mean(face_data["texture_history"])
                
                # REJECT if Moire is too high (Screen detected) or Variance is too low (Blurry/Flat photo)
                if avg_var > config.TEXTURE_THRESHOLD and moire < config.MOIRE_THRESHOLD:
                    face_data["textured"] = True
                    print(f"🛡️ SURFACE VERIFIED")
                else:
                    reason = "SCREEN DETECTED" if moire >= config.MOIRE_THRESHOLD else "FLAT SURFACE"
                    cv2.putText(frame, f"SPOOF ALERT: {reason}", (o_left, o_top-40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                    # Draw a red warning box
                    cv2.rectangle(frame, (o_left, o_top), (o_right, o_bottom), (0, 0, 255), 4)
                    continue

            # --- 2. 3D POSE VERIFICATION (Anti-Static Photo) ---
            if face_data["textured"] and not face_data["turned"]:
                yaw = get_face_yaw(face_landmarks)
                face_data["yaw_history"].append(yaw)
                if len(face_data["yaw_history"]) > 15: face_data["yaw_history"].pop(0)
                
                yaw_range = max(face_data["yaw_history"]) - min(face_data["yaw_history"])
                if yaw_range > config.POSE_YAW_THRESHOLD:
                    face_data["turned"] = True
                    print(f"🛡️ 3D MOTION VERIFIED")
                
                cv2.putText(frame, "VERIFYING 3D: TURN HEAD SLIGHTLY", (o_left, o_top-40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            # --- 3. BLINK VERIFICATION (Anti-Video) ---
            if face_data["turned"] and not face_data["blinked"]:
                ear = (calculate_ear(face_landmarks['left_eye']) + calculate_ear(face_landmarks['right_eye'])) / 2.0
                if ear < config.EYE_AR_THRESHOLD:
                    face_data["blinked"] = True
                    face_data["live"] = True
                    print(f"🛡️ BLINK VERIFIED - LIVENESS CONFIRMED")
                
                cv2.putText(frame, "FINAL STEP: BLINK EYES", (o_left, o_top-40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

            # --- 4. RECOGNITION & MARK ---
            if face_data["live"]:
                # Only run heavy face recognition AFTER we are 100% sure it's a live person
                if face_data["frames"] < config.VALIDATION_FRAMES:
                    face_distances = face_recognition.face_distance(known_encodings, face_encoding)
                    if len(face_distances) > 0:
                        best_index = np.argmin(face_distances)
                        if face_distances[best_index] < config.MATCH_THRESHOLD:
                            face_data["label"], face_data["frames"] = known_ids[best_index], face_data["frames"] + 1
                        else: face_data["label"], face_data["frames"] = "unknown", 0

                if face_data["frames"] >= config.VALIDATION_FRAMES and not face_data["marked"]:
                    user_id = face_data["label"]
                    if user_id != "unknown":
                        if time.time() - user_cooldowns.get(user_id, 0) > (config.COOLDOWN_MINUTES * 60):
                            result = mark_attendance(user_id)
                            if result:
                                user_cooldowns[user_id] = time.time()
                                face_data["marked"] = True
                                print(f"✅ SUCCESS: {user_names.get(user_id)}")
                        else: face_data["marked"] = True

            # UI Styling
            color = (0, 255, 0) if face_data["marked"] else ((255, 165, 0) if face_data["live"] else (0, 0, 255))
            status = "ACCESS GRANTED" if face_data["marked"] else ("MATCHING..." if face_data["live"] else "SPOOF CHECK")
            cv2.rectangle(frame, (o_left, o_top), (o_right, o_bottom), color, 2)
            cv2.putText(frame, user_names.get(face_data["label"], "Scanning..."), (o_left, o_top-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            cv2.putText(frame, status, (o_left, o_bottom+25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        if time.time() > next_cleanup:
            to_delete = [fid for fid, d in tracked_faces.items() if time.time() - d["last_seen"] > 2]
            for fid in to_delete: del tracked_faces[fid]
            next_cleanup = time.time() + 30

        cv2.imshow('ULTRA-SECURE KIOSK', frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()