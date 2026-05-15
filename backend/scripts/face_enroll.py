# pyrefly: ignore [missing-import]
# ╔══════════════════════════════════════════════════════════════╗
# ║        SECURE FACE ENROLLMENT STATION v3.0                  ║
# ║              Production Ready — Admin Grade                  ║
# ╚══════════════════════════════════════════════════════════════╝

import cv2
import face_recognition
import numpy as np
import requests
import time
import threading
import queue
import pyttsx3
from datetime import datetime
from PIL import Image, ImageTk, ImageDraw
import tkinter as tk
from tkinter import ttk, messagebox
import config
from scipy.spatial import distance as dist

# ── Colors ────────────────────────────────────────────────────
BG      = '#0d0d0d'
HDR     = '#161616'
GREEN   = '#00C853'
BLUE    = '#1565C0'
ORANGE  = '#E65100'
RED     = '#B71C1C'
PURPLE  = '#4A148C'
WHITE   = '#FFFFFF'
LGRAY   = '#888888'
DGRAY   = '#2a2a2a'

# ══════════════════════════════════════════════════════════════
#  VOICE ENGINE
# ══════════════════════════════════════════════════════════════
_vq = queue.Queue()
def _voice_worker():
    tts = pyttsx3.init()
    tts.setProperty('rate', 150)
    while True:
        txt = _vq.get()
        if txt is None: break
        try:
            tts.say(txt)
            tts.runAndWait()
        except: pass
        _vq.task_done()
threading.Thread(target=_voice_worker, daemon=True).start()

def speak(text):
    while not _vq.empty():
        try: _vq.get_nowait()
        except: pass
    _vq.put(text)

# ══════════════════════════════════════════════════════════════
#  ANTI-SPOOF HELPERS
# ══════════════════════════════════════════════════════════════
def calc_ear(eye):
    A = dist.euclidean(eye[1], eye[5])
    B = dist.euclidean(eye[2], eye[4])
    C = dist.euclidean(eye[0], eye[3])
    return (A + B) / (2.0 * C)

def calc_yaw(lm):
    le = np.mean(lm['left_eye'], axis=0)
    re = np.mean(lm['right_eye'], axis=0)
    nt = lm['nose_bridge'][-1]
    return dist.euclidean(nt, le) / (dist.euclidean(nt, re) + 1e-6)

def calc_texture(frame, t, r, b, l):
    roi = frame[t:b, l:r]
    if roi.size == 0: return 0, 0
    g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    var = cv2.Laplacian(g, cv2.CV_64F).var()
    dft = cv2.dft(np.float32(g), flags=cv2.DFT_COMPLEX_OUTPUT)
    ds = np.fft.fftshift(dft)
    ms = 20 * np.log(cv2.magnitude(ds[:,:,0], ds[:,:,1]) + 1)
    return var, np.mean(ms)

def hex2bgr(h):
    h = h.lstrip('#')
    return (int(h[4:6],16), int(h[2:4],16), int(h[0:2],16))

# ══════════════════════════════════════════════════════════════
#  ENROLLMENT APPLICATION
# ══════════════════════════════════════════════════════════════
class EnrollApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Secure Face Enrollment v3.0")
        self.root.configure(bg=BG)
        self.root.attributes('-fullscreen', True)
        
        self.token = None
        self.target_user = None
        self.captured_descriptors = []
        self.cap = None
        self.photo = None
        
        # Liveness State
        self.liveness = {
            "textured": False, "turned": False, "blinked": False,
            "tex_h": [], "yaw_h": []
        }
        
        self._show_login()

    # ─────────────────────────────────────────────────────────
    #  SCREEN 1: LOGIN
    # ─────────────────────────────────────────────────────────
    def _show_login(self):
        for w in self.root.winfo_children(): w.destroy()
        
        frame = tk.Frame(self.root, bg=HDR, padx=40, pady=40, highlightbackground=DGRAY, highlightthickness=1)
        frame.place(relx=0.5, rely=0.5, anchor='center')
        
        tk.Label(frame, text="🔒", font=('Segoe UI Emoji', 40), bg=HDR, fg=BLUE).pack(pady=(0,10))
        tk.Label(frame, text="ADMIN LOGIN", font=('Arial', 20, 'bold'), bg=HDR, fg=WHITE).pack(pady=(0,20))
        
        tk.Label(frame, text="Email / Username", font=('Arial', 10), bg=HDR, fg=LGRAY).pack(anchor='w')
        self.ent_user = tk.Entry(frame, font=('Arial', 14), bg=BG, fg=WHITE, borderwidth=0, insertbackground=WHITE)
        self.ent_user.pack(fill='x', pady=(5,15), ipady=8)
        tk.Frame(frame, height=1, bg=DGRAY).pack(fill='x', pady=(0,15))
        
        tk.Label(frame, text="Password", font=('Arial', 10), bg=HDR, fg=LGRAY).pack(anchor='w')
        self.ent_pass = tk.Entry(frame, font=('Arial', 14), bg=BG, fg=WHITE, borderwidth=0, show="●", insertbackground=WHITE)
        self.ent_pass.pack(fill='x', pady=(5,15), ipady=8)
        tk.Frame(frame, height=1, bg=DGRAY).pack(fill='x', pady=(0,25))
        
        btn = tk.Button(frame, text="AUTHENTICATE", font=('Arial', 12, 'bold'), 
                        bg=BLUE, fg=WHITE, activebackground='#1a237e', activeforeground=WHITE,
                        borderwidth=0, cursor='hand2', command=self._handle_login)
        btn.pack(fill='x', ipady=12)
        
        self.lbl_error = tk.Label(frame, text="", font=('Arial', 10), bg=HDR, fg=RED)
        self.lbl_error.pack(pady=(15,0))

    def _handle_login(self):
        u, p = self.ent_user.get(), self.ent_pass.get()
        try:
            r = requests.post(f"{config.API_BASE_URL}/users/login", json={"id": u, "password": p}, timeout=10)
            if r.status_code == 200:
                self.token = r.json().get('token')
                self._show_selection()
            else:
                self.lbl_error.config(text=r.json().get('message', 'Login Failed'))
        except Exception as e:
            self.lbl_error.config(text="Connection Error")

    # ─────────────────────────────────────────────────────────
    #  SCREEN 2: SELECTION
    # ─────────────────────────────────────────────────────────
    def _show_selection(self):
        for w in self.root.winfo_children(): w.destroy()
        
        # Header
        hdr = tk.Frame(self.root, bg=HDR, height=80)
        hdr.pack(fill='x')
        tk.Label(hdr, text="👤 EMPLOYEE ENROLLMENT SELECTION", font=('Arial', 18, 'bold'), bg=HDR, fg=WHITE).pack(side='left', padx=30, pady=20)
        
        # Container
        container = tk.Frame(self.root, bg=BG)
        container.pack(fill='both', expand=True, padx=100, pady=50)
        
        # Listbox
        list_frame = tk.Frame(container, bg=DGRAY)
        list_frame.pack(fill='both', expand=True)
        
        style = ttk.Style()
        style.theme_use('default')
        style.configure("Treeview", background=DGRAY, foreground=WHITE, fieldbackground=DGRAY, rowheight=40, font=('Arial', 11))
        style.map("Treeview", background=[('selected', BLUE)])
        
        self.tree = ttk.Treeview(list_frame, columns=('ID', 'Name', 'Status'), show='headings')
        self.tree.heading('ID', text='EMPLOYEE ID')
        self.tree.heading('Name', text='NAME')
        self.tree.heading('Status', text='STATUS')
        self.tree.pack(side='left', fill='both', expand=True)
        
        sb = ttk.Scrollbar(list_frame, orient="vertical", command=self.tree.yview)
        sb.pack(side='right', fill='y')
        self.tree.configure(yscrollcommand=sb.set)
        
        # Actions
        actions = tk.Frame(container, bg=BG, pady=30)
        actions.pack(fill='x')
        
        tk.Button(actions, text="START ENROLLMENT", font=('Arial', 12, 'bold'), bg=GREEN, fg=WHITE, padx=30, py=10, borderwidth=0, command=self._start_capture).pack(side='right')
        tk.Button(actions, text="REFRESH LIST", font=('Arial', 10), bg=DGRAY, fg=WHITE, padx=20, borderwidth=0, command=self._load_employees).pack(side='left')
        
        self._load_employees()

    def _load_employees(self):
        for i in self.tree.get_children(): self.tree.delete(i)
        try:
            h = {"Authorization": f"Bearer {self.token}", "X-Role-Context": "Admin"}
            r = requests.get(f"{config.API_BASE_URL}/users", headers=h, timeout=10)
            if r.status_code == 200:
                for emp in r.json():
                    status = "✅ ENROLLED" if emp.get('faceEnrolled') else "❌ NOT ENROLLED"
                    self.tree.insert('', 'end', iid=emp['_id'], values=(emp['employeeId'], emp['name'], status))
        except: messagebox.showerror("Error", "Could not fetch employees")

    def _start_capture(self):
        sel = self.tree.selection()
        if not sel: return
        uid = sel[0]
        item = self.tree.item(uid)
        self.target_user = {"_id": uid, "name": item['values'][1]}
        
        self._show_camera_screen()

    # ─────────────────────────────────────────────────────────
    #  SCREEN 3: CAMERA / CAPTURE
    # ─────────────────────────────────────────────────────────
    def _show_camera_screen(self):
        for w in self.root.winfo_children(): w.destroy()
        
        self.cam_canvas = tk.Canvas(self.root, bg='black', highlightthickness=0)
        self.cam_canvas.pack(fill='both', expand=True)
        
        # Overlay Info
        self.info_overlay = tk.Frame(self.root, bg='#00000099', padx=20, pady=20)
        self.info_overlay.place(relx=0.05, rely=0.05)
        
        tk.Label(self.info_overlay, text=f"ENROLLING: {self.target_user['name'].upper()}", font=('Arial', 16, 'bold'), bg='#00000000', fg=WHITE).pack(anchor='w')
        self.lbl_step = tk.Label(self.info_overlay, text="Step 1: Surface Verification", font=('Arial', 12), bg='#00000000', fg=ORANGE)
        self.lbl_step.pack(anchor='w', pady=(5,0))
        
        # Progress
        self.prog_frame = tk.Frame(self.root, bg='#00000099', padx=20, pady=10)
        self.prog_frame.place(relx=0.5, rely=0.9, anchor='center')
        self.sample_dots = []
        for i in range(5):
            d = tk.Label(self.prog_frame, text="○", font=('Arial', 24), bg='#00000000', fg=LGRAY)
            d.pack(side='left', padx=10)
            self.sample_dots.append(d)
            
        self._open_camera()
        speak(f"Starting enrollment for {self.target_user['name']}. Please look directly at the camera.")
        self._loop()

    def _open_camera(self):
        src = 0 if config.CAMERA_SOURCE == 0 else config.RTSP_URL
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def _loop(self):
        if not self.cap or not self.cap.isOpened(): return
        
        ret, frame = self.cap.read()
        if not ret: return
        
        # Face detection
        small = cv2.resize(frame, (0,0), fx=0.25, fy=0.25)
        rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        locs = face_recognition.face_locations(rgb, model="hog")
        lms_list = face_recognition.face_landmarks(rgb, locs)
        
        if locs:
            t,r,b,l = [v*4 for v in locs[0]]
            lm = lms_list[0]
            
            # 1. Texture
            if not self.liveness["textured"]:
                self.lbl_step.config(text="Step 1: Surface Verification", fg=ORANGE)
                v, m = calc_texture(frame, t,r,b,l)
                self.liveness["tex_h"].append(v)
                if len(self.liveness["tex_h"]) > 10: self.liveness["tex_h"].pop(0)
                if np.mean(self.liveness["tex_h"]) > config.TEXTURE_THRESHOLD and m < config.MOIRE_THRESHOLD:
                    self.liveness["textured"] = True
                    speak("Surface verified. Now slowly turn your head.")
                self._box(frame, l,t,r,b, ORANGE, "VERIFYING SURFACE...")
            
            # 2. Yaw
            elif not self.liveness["turned"]:
                self.lbl_step.config(text="Step 2: Motion Verification", fg=YELLOW)
                y = calc_yaw(lm)
                self.liveness["yaw_h"].append(y)
                if len(self.liveness["yaw_h"]) > 15: self.liveness["yaw_h"].pop(0)
                if (max(self.liveness["yaw_h"]) - min(self.liveness["yaw_h"])) > config.POSE_YAW_THRESHOLD:
                    self.liveness["turned"] = True
                    speak("Motion verified. Now blink once.")
                self._box(frame, l,t,r,b, YELLOW, "TURN HEAD SLIGHTLY")
                
            # 3. Blink
            elif not self.liveness["blinked"]:
                self.lbl_step.config(text="Step 3: Liveness Check", fg=PURPLE)
                e = (calc_ear(lm['left_eye']) + calc_ear(lm['right_eye'])) / 2.0
                if e < config.EYE_AR_THRESHOLD:
                    self.liveness["blinked"] = True
                    speak("Liveness verified. Capturing face samples.")
                self._box(frame, l,t,r,b, PURPLE, "BLINK YOUR EYES")
                
            # 4. Capture 5 samples
            else:
                self.lbl_step.config(text="Step 4: Capturing Angles", fg=GREEN)
                self._box(frame, l,t,r,b, GREEN, f"SAMPLES: {len(self.captured_descriptors)}/5")
                
                if len(self.captured_descriptors) < 5:
                    rgb_full = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    enc = face_recognition.face_encodings(rgb_full, [(t,r,b,l)])[0]
                    
                    is_new = True
                    for ex in self.captured_descriptors:
                        if np.linalg.norm(ex - enc) < 0.38: is_new = False; break
                        
                    if is_new:
                        self.captured_descriptors.append(enc)
                        idx = len(self.captured_descriptors) - 1
                        self.sample_dots[idx].config(text="●", fg=GREEN)
                        speak(f"Sample {len(self.captured_descriptors)} captured.")
                        time.sleep(0.5)
                else:
                    self._finalize()
                    return
        
        self._render(frame)
        self.root.after(30, self._loop)

    def _finalize(self):
        self.cap.release()
        speak("All samples captured. Uploading to server.")
        
        try:
            h = {"Authorization": f"Bearer {self.token}", "X-Role-Context": "Admin"}
            payload = {
                "userId": self.target_user['_id'],
                "descriptors": [d.tolist() for d in self.captured_descriptors]
            }
            r = requests.post(f"{config.API_BASE_URL}/attendance/enroll-face", json=payload, headers=h, timeout=15)
            if r.status_code == 200:
                messagebox.showinfo("Success", f"Successfully enrolled {self.target_user['name']}")
                self._show_selection()
            else:
                messagebox.showerror("Failed", r.json().get('message', 'Upload Error'))
                self._show_selection()
        except:
            messagebox.showerror("Error", "Server Connection Failed")
            self._show_selection()

    # ─────────────────────────────────────────────────────────
    #  HELPERS
    # ─────────────────────────────────────────────────────────
    def _render(self, frame):
        cw, ch = self.cam_canvas.winfo_width(), self.cam_canvas.winfo_height()
        if cw < 2: return
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb).resize((cw, ch), Image.LANCZOS)
        
        draw = ImageDraw.Draw(img)
        cx, cy = cw // 2, ch // 2
        rw, rh = int(cw * 0.18), int(ch * 0.40)
        draw.ellipse([cx-rw, cy-rh, cx+rw, cy+rh], outline=GREEN, width=2)
        
        self.photo = ImageTk.PhotoImage(img)
        self.cam_canvas.create_image(0,0, anchor='nw', image=self.photo)

    def _box(self, frame, l, t, r, b, col, txt):
        c = hex2bgr(col)
        cv2.rectangle(frame, (l,t), (r,b), c, 2)
        cv2.putText(frame, txt, (l, b+30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, c, 2)

if __name__ == "__main__":
    root = tk.Tk()
    app = EnrollApp(root)
    root.mainloop()
