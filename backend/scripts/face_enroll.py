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
import threading
import pyttsx3

# --- Vocal Feedback ---
def speak(text):
    def _run_speak():
        try:
            engine = pyttsx3.init()
            engine.setProperty('rate', 150)
            engine.say(text)
            engine.runAndWait()
            engine.stop()
        except Exception as e: print(f"🔊 TTS Error: {e}")
    threading.Thread(target=_run_speak, daemon=True).start()

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
    face_img = frame[top:bottom, left:right]
    if face_img.size == 0: return 0, 0
    gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    dft = cv2.dft(np.float32(gray), flags=cv2.DFT_COMPLEX_OUTPUT)
    dft_shift = np.fft.fftshift(dft)
    magnitude_spectrum = 20 * np.log(cv2.magnitude(dft_shift[:, :, 0], dft_shift[:, :, 1]) + 1)
    moire_score = np.mean(magnitude_spectrum)
    return variance, moire_score

def login_admin():
    print("\n--- Admin Login Required ---")
    email = input("Email: ")
    password = input("Password: ")
    try:
        response = requests.post(f"{config.API_BASE_URL}/users/login", json={
            "id": email,
            "password": password
        })
        if response.status_code == 200:
            data = response.json()
            return data.get('token')
        else:
            print(f"❌ Login failed: {response.json().get('message')}")
    except Exception as e:
        print(f"❌ Connection error during login: {e}")
    return None

def get_unrolled_employees(token):
    try:
        # Fetching all users
        headers = {"Authorization": f"Bearer {token}", "X-Role-Context": "Admin"}
        response = requests.get(f"{config.API_BASE_URL}/users", headers=headers)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"❌ Error fetching employees: {response.status_code}")
    except Exception as e:
        print(f"❌ Error fetching employees: {e}")
    return []

def enroll_employee(token, user_id, descriptors):
    try:
        url = f"{config.API_BASE_URL}/attendance/enroll-face"
        headers = {"Authorization": f"Bearer {token}", "X-Role-Context": "Admin"}
        payload = {
            "userId": user_id,
            "descriptors": [d.tolist() for d in descriptors]
        }
        response = requests.post(url, json=payload, headers=headers)
        return response.json()
    except Exception as e:
        print(f"❌ API Error: {e}")
        return None

def connect_camera():
    source = 0 if config.CAMERA_SOURCE == 0 else config.RTSP_URL
    cap = cv2.VideoCapture(source)
    return cap

def main():
    print("\n--- [IP CAMERA] Face Enrollment Tool ---")
    
    # 0. Login
    token = login_admin()
    if not token:
        return

    # 1. Select Employee
    employees = get_unrolled_employees(token)
    if not employees:
        print("No employees found or unauthorized. Make sure API is running.")
        return

    print("\nAvailable Employees:")
    for i, emp in enumerate(employees):
        status = "✅ Enrolled" if emp.get('faceEnrolled') else "❌ Not Enrolled"
        print(f"{i+1}. {emp['name']} ({emp['employeeId']}) - {status}")

    try:
        choice = int(input("\nEnter the number of the employee to enroll: ")) - 1
        if choice < 0 or choice >= len(employees):
            print("Invalid selection.")
            return
        target_user = employees[choice]
    except ValueError:
        print("Invalid input.")
        return

    print(f"\nInitializing IP Camera for: {target_user['name']}...")
    cap = connect_camera()
    if not cap.isOpened():
        print("Could not open camera stream.")
        return

    print("Camera connected. Instructions:")
    print("1. Look directly into the camera.")
    print("2. Movement/Blink is required for liveness verification.")
    
    speak(f"Starting enrollment for {target_user['name']}. Look at the camera.")

    captured_descriptors = []
    liveness = {"textured": False, "turned": False, "blinked": False, "texture_history": [], "yaw_history": []}
    
    while len(captured_descriptors) < 5:
        ret, frame = cap.read()
        if not ret: break

        small_frame = cv2.resize(frame, (0, 0), fx=0.25, fy=0.25)
        rgb_small = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
        
        face_locations = face_recognition.face_locations(rgb_small)
        face_landmarks_list = face_recognition.face_landmarks(rgb_small, face_locations)
        
        display_frame = frame.copy()
        
        if len(face_locations) == 1:
            top, right, bottom, left = [v*4 for v in face_locations[0]]
            landmarks = face_landmarks_list[0]
            cv2.rectangle(display_frame, (left, top), (right, bottom), (0, 255, 0), 2)
            
            # --- 1. Texture Check ---
            if not liveness["textured"]:
                var, moire = check_texture(frame, top, right, bottom, left)
                liveness["texture_history"].append(var)
                if len(liveness["texture_history"]) > 10: liveness["texture_history"].pop(0)
                if np.mean(liveness["texture_history"]) > config.TEXTURE_THRESHOLD and moire < config.MOIRE_THRESHOLD:
                    liveness["textured"] = True
                    speak("Surface verified.")
                else:
                    cv2.putText(display_frame, "VERIFYING SURFACE...", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

            # --- 2. Pose Check ---
            elif not liveness["turned"]:
                yaw = get_face_yaw(landmarks)
                liveness["yaw_history"].append(yaw)
                if len(liveness["yaw_history"]) > 15: liveness["yaw_history"].pop(0)
                if (max(liveness["yaw_history"]) - min(liveness["yaw_history"])) > config.POSE_YAW_THRESHOLD:
                    liveness["turned"] = True
                    speak("Motion verified. Now blink.")
                else:
                    cv2.putText(display_frame, "TURN HEAD SLIGHTLY", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

            # --- 3. Blink Check ---
            elif not liveness["blinked"]:
                ear = (calculate_ear(landmarks['left_eye']) + calculate_ear(landmarks['right_eye'])) / 2.0
                if ear < config.EYE_AR_THRESHOLD:
                    liveness["blinked"] = True
                    speak("Liveness confirmed. Capturing angles.")
                else:
                    cv2.putText(display_frame, "BLINK YOUR EYES", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

            # --- 4. Capture ---
            else:
                cv2.putText(display_frame, f"SAMPLES: {len(captured_descriptors)}/5", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                cv2.putText(display_frame, "LOOK AT DIFFERENT ANGLES", (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                rgb_full = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                encoding = face_recognition.face_encodings(rgb_full, [ (top, right, bottom, left) ])[0]
                
                is_new = True
                for existing in captured_descriptors:
                    if np.linalg.norm(existing - encoding) < 0.38:
                        is_new = False; break
                
                if is_new:
                    captured_descriptors.append(encoding)
                    speak(f"Angle {len(captured_descriptors)} captured.")
                    time.sleep(0.8)

        else:
            msg = "Position your face" if not face_locations else "Multiple faces!"
            cv2.putText(display_frame, msg, (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

        cv2.imshow("Secure Face Enrollment", display_frame)
        if cv2.waitKey(1) & 0xFF == ord('q'): break

    cap.release()
    cv2.destroyAllWindows()

    if len(captured_descriptors) == 5:
        print("\nUploading face data to server...")
        result = enroll_employee(token, target_user['_id'], captured_descriptors)
        if result and result.get('success'):
            print(f"✅ SUCCESSFULLY ENROLLED: {target_user['name']}")
        else:
            print(f"❌ ENROLLMENT FAILED: {result.get('message', 'Unknown error')}")
    else:
        print("\nEnrollment cancelled or incomplete.")

if __name__ == "__main__":
    main()
