# pyrefly: ignore [missing-import]
# ╔══════════════════════════════════════════════════════════════╗
# ║        ZERO-SPOOF BIOMETRIC ATTENDANCE KIOSK v3.0           ║
# ║              Production Ready — Factory Grade                ║
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
import config
from scipy.spatial import distance as dist

# ── Change this to your company name ──────────────────────────
COMPANY_NAME  = "FACTORY ATTENDANCE SYSTEM"
OVERLAY_SECS  = 5      # Seconds to show result screen

# ── Colors ────────────────────────────────────────────────────
BG      = '#0d0d0d'
HDR     = '#161616'
GREEN   = '#00C853'
BLUE    = '#1565C0'
ORANGE  = '#E65100'
RED     = '#B71C1C'
PURPLE  = '#4A148C'
YELLOW  = '#F9A825'
WHITE   = '#FFFFFF'
LGRAY   = '#888888'
DGRAY   = '#2a2a2a'

# ══════════════════════════════════════════════════════════════
#  VOICE ENGINE  (queue-based — Windows safe)
# ══════════════════════════════════════════════════════════════
_vq          = queue.Queue()
_last_spoken = {}

def _voice_worker():
    tts = pyttsx3.init()
    tts.setProperty('rate', 155)
    tts.setProperty('volume', 1.0)
    # Prefer a clear English voice
    for v in tts.getProperty('voices'):
        if any(n in v.name.lower() for n in ['zira','david','hazel','george']):
            tts.setProperty('voice', v.id)
            break
    while True:
        txt = _vq.get()
        if txt is None:
            break
        try:
            tts.say(txt)
            tts.runAndWait()
        except Exception:
            pass
        _vq.task_done()

threading.Thread(target=_voice_worker, daemon=True).start()

def speak(text, key=None, cd=5):
    """Put text in voice queue. key+cd prevents repeating same line."""
    now = time.time()
    if key and now - _last_spoken.get(key, 0) < cd:
        return
    if key:
        _last_spoken[key] = now
    # Drop stale queued phrases so new instruction plays immediately
    while not _vq.empty():
        try: _vq.get_nowait()
        except: pass
    _vq.put(text)

# ══════════════════════════════════════════════════════════════
#  API
# ══════════════════════════════════════════════════════════════
user_names     = {}
user_cooldowns = {}

def get_employees():
    try:
        r = requests.get(f"{config.API_BASE_URL}/attendance/face-descriptors", timeout=10)
        if r.status_code == 200:
            emps = r.json().get('employees', [])
            enc, ids = [], []
            for e in emps:
                user_names[e['_id']] = e['name']
                for d in e['faceDescriptors']:
                    enc.append(np.array(d))
                    ids.append(e['_id'])
            print(f"✅ {len(emps)} employees loaded")
            return enc, ids
    except Exception as ex:
        print(f"❌ API error: {ex}")
    return [], []

def mark_attendance(uid):
    try:
        r = requests.post(
            f"{config.API_BASE_URL}/attendance/face-checkin",
            json={"userId": uid, "timestamp": datetime.now().isoformat()},
            timeout=10
        )
        if r.status_code == 200:
            return r.json()
    except Exception as ex:
        print(f"❌ API error: {ex}")
    return None

# ══════════════════════════════════════════════════════════════
#  ANTI-SPOOF HELPERS
# ══════════════════════════════════════════════════════════════
def calc_ear(eye):
    A = dist.euclidean(eye[1], eye[5])
    B = dist.euclidean(eye[2], eye[4])
    C = dist.euclidean(eye[0], eye[3])
    return (A + B) / (2.0 * C)

def calc_yaw(lm):
    le = np.mean(lm['left_eye'],   axis=0)
    re = np.mean(lm['right_eye'],  axis=0)
    nt = lm['nose_bridge'][-1]
    return dist.euclidean(nt, le) / (dist.euclidean(nt, re) + 1e-6)

def calc_texture(frame, t, r, b, l):
    roi = frame[t:b, l:r]
    if roi.size == 0:
        return 0, 0
    g   = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    var = cv2.Laplacian(g, cv2.CV_64F).var()
    dft = cv2.dft(np.float32(g), flags=cv2.DFT_COMPLEX_OUTPUT)
    ds  = np.fft.fftshift(dft)
    ms  = 20 * np.log(cv2.magnitude(ds[:,:,0], ds[:,:,1]) + 1)
    return var, np.mean(ms)

def hex2bgr(h):
    h = h.lstrip('#')
    return (int(h[4:6],16), int(h[2:4],16), int(h[0:2],16))

# ══════════════════════════════════════════════════════════════
#  KIOSK APPLICATION
# ══════════════════════════════════════════════════════════════
class KioskApp:
    def __init__(self, root, enc, ids):
        self.root   = root
        self.enc    = enc
        self.ids    = ids
        self.faces  = {}
        self.photo  = None
        self.overlay_until = 0
        self.fc     = 0        # frame counter

        self._build_ui()
        self._open_camera()
        self._update_clock()
        self._loop()

    # ─────────────────────────────────────────────────────────
    #  UI CONSTRUCTION
    # ─────────────────────────────────────────────────────────
    def _build_ui(self):
        self.root.configure(bg=BG)
        self.root.attributes('-fullscreen', True)
        self.root.attributes('-topmost',    True)
        self.root.protocol("WM_DELETE_WINDOW", lambda: None)
        self.root.bind('<Alt-F4>', lambda e: 'break')
        self.root.bind('<Escape>', lambda e: 'break')
        self.root.bind('<F11>',    lambda e: 'break')

        # ── HEADER ──────────────────────────────────────────
        hdr = tk.Frame(self.root, bg=HDR, height=85)
        hdr.pack(fill='x')
        hdr.pack_propagate(False)

        tk.Label(hdr, text="🏭", font=('Segoe UI Emoji',26),
                 bg=HDR, fg=GREEN).pack(side='left', padx=(18,6), pady=18)
        tk.Label(hdr, text=COMPANY_NAME, font=('Arial',24,'bold'),
                 bg=HDR, fg=WHITE).pack(side='left', pady=18)

        right = tk.Frame(hdr, bg=HDR)
        right.pack(side='right', padx=22, pady=10)
        self.lbl_time = tk.Label(right, font=('Arial',22,'bold'), bg=HDR, fg=WHITE)
        self.lbl_time.pack()
        self.lbl_date = tk.Label(right, font=('Arial',12),        bg=HDR, fg=LGRAY)
        self.lbl_date.pack()

        # ── CAMERA CANVAS ───────────────────────────────────
        self.cam_canvas = tk.Canvas(self.root, bg='black', highlightthickness=0)
        self.cam_canvas.pack(fill='both', expand=True)

        # ── RESULT OVERLAY (hidden until needed) ────────────
        self.ov = tk.Frame(self.root, bg=GREEN)
        self.ov.pack_propagate(False)

        self.ov_icon   = tk.Label(self.ov, font=('Segoe UI Emoji',100), bg=GREEN)
        self.ov_icon.pack(pady=(50,0))

        self.ov_title  = tk.Label(self.ov, font=('Arial',52,'bold'), bg=GREEN, fg=WHITE)
        self.ov_title.pack(pady=(0,6))

        self.ov_name   = tk.Label(self.ov, font=('Arial',44,'bold'), bg=GREEN, fg=WHITE)
        self.ov_name.pack(pady=(0,8))

        self.ov_msg    = tk.Label(self.ov, font=('Arial',26), bg=GREEN,
                                  fg='#eeeeee', wraplength=1000, justify='center')
        self.ov_msg.pack(pady=(0,6))

        self.ov_time   = tk.Label(self.ov, font=('Arial',18), bg=GREEN, fg='#cccccc')
        self.ov_time.pack()

        # Countdown bar
        pb_wrap = tk.Frame(self.ov, bg=GREEN)
        pb_wrap.pack(fill='x', padx=150, pady=28)
        self.pb = tk.Canvas(pb_wrap, height=14, highlightthickness=0)
        self.pb.pack(fill='x')

        # ── STATUS BAR ──────────────────────────────────────
        sb = tk.Frame(self.root, bg=HDR, height=100)
        sb.pack(fill='x')
        sb.pack_propagate(False)

        # Step dots
        steps_f = tk.Frame(sb, bg=HDR)
        steps_f.pack(pady=(10,2))
        self.step_labels = []
        step_names = ['Surface Check', 'Head Turn', 'Blink', 'Scanning']
        step_icons = ['🛡️', '↔', '👁', '🔍']
        for i, (ic, nm) in enumerate(zip(step_icons, step_names)):
            col_f = tk.Frame(steps_f, bg=HDR)
            col_f.pack(side='left', padx=22)
            dot = tk.Label(col_f, text='●', font=('Arial',20), bg=HDR, fg=DGRAY)
            dot.pack()
            lbl = tk.Label(col_f, text=f"{ic} {nm}", font=('Arial',11), bg=HDR, fg=LGRAY)
            lbl.pack()
            self.step_labels.append((dot, lbl))

        self.lbl_status = tk.Label(sb, font=('Arial',19,'bold'),
                                   bg=HDR, fg=GREEN,
                                   text="👤  PLEASE STAND IN FRONT OF THE CAMERA")
        self.lbl_status.pack(pady=(2,8))

    # ─────────────────────────────────────────────────────────
    #  CAMERA
    # ─────────────────────────────────────────────────────────
    def _open_camera(self):
        src = 0 if config.CAMERA_SOURCE == 0 else config.RTSP_URL
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not self.cap.isOpened():
            self._status("❌  CAMERA NOT CONNECTED — PLEASE CHECK", RED)
            speak("Camera is not connected. Please check the camera.")

    # ─────────────────────────────────────────────────────────
    #  CLOCK
    # ─────────────────────────────────────────────────────────
    def _update_clock(self):
        now = datetime.now()
        self.lbl_time.config(text=now.strftime("%I:%M:%S %p"))
        self.lbl_date.config(text=now.strftime("%A,  %d %B %Y"))
        self.root.after(1000, self._update_clock)

    # ─────────────────────────────────────────────────────────
    #  MAIN LOOP
    # ─────────────────────────────────────────────────────────
    def _loop(self):
        # Overlay countdown
        if self.ov.winfo_ismapped():
            rem = self.overlay_until - time.time()
            if rem <= 0:
                self._hide_ov()
            else:
                self._draw_pb(rem)
            self.root.after(30, self._loop)
            return

        if not self.cap.isOpened():
            self.root.after(500, self._loop)
            return

        ret, frame = self.cap.read()
        if not ret:
            self.cap.release()
            time.sleep(1)
            self._open_camera()
            self.root.after(30, self._loop)
            return

        self.fc += 1

        # Run face pipeline every 2nd frame (balance speed vs accuracy)
        if self.fc % 2 == 0:
            sm = cv2.resize(frame, (0,0), fx=0.25, fy=0.25)
            rgb = cv2.cvtColor(sm, cv2.COLOR_BGR2RGB)
            locs = face_recognition.face_locations(rgb, model="hog")
            lms  = face_recognition.face_landmarks(rgb, locs)
            encs = face_recognition.face_encodings(rgb, locs)

            if not locs:
                self.faces.clear()
                self._status("👤  PLEASE STAND IN FRONT OF THE CAMERA", GREEN)
                self._set_steps(-1)
                speak("Please look at the camera.", key="idle", cd=10)
            else:
                self._pipeline(frame, locs, lms, encs)

        self._render(frame)
        self.root.after(30, self._loop)

    # ─────────────────────────────────────────────────────────
    #  FACE PIPELINE
    # ─────────────────────────────────────────────────────────
    def _pipeline(self, frame, locs, lms_list, encs):
        now = time.time()

        for (t,r,b,l), lm, enc in zip(locs, lms_list, encs):
            ot,or_,ob,ol = t*4, r*4, b*4, l*4
            center = ((ol+or_)//2, (ot+ob)//2)

            # ── Track this face ──────────────────────────
            fid = None
            for k, d in self.faces.items():
                if dist.euclidean(center, d['ctr']) < 100:
                    fid = k; break
            if not fid:
                fid = f"f{int(now*1000)}"
                self.faces[fid] = dict(
                    ctr=center, label='unknown', frames=0,
                    yaw_h=[], tex_h=[],
                    textured=False, turned=False,
                    blinked=False, live=False, marked=False, ts=now
                )
            fd = self.faces[fid]
            fd['ctr'] = center
            fd['ts']  = now

            # Already done — just show green box
            if fd['marked']:
                self._box(frame, ol,ot,or_,ob, GREEN, "✓ ACCESS GRANTED",
                          user_names.get(fd['label'],''))
                self._set_steps(4)
                continue

            # ── STEP 1: Texture / Moiré ──────────────────
            if not fd['textured']:
                self._set_steps(0)
                v, m = calc_texture(frame, ot,or_,ob,ol)
                fd['tex_h'].append(v)
                if len(fd['tex_h']) > 10: fd['tex_h'].pop(0)
                avg = np.mean(fd['tex_h'])

                if avg > config.TEXTURE_THRESHOLD and m < config.MOIRE_THRESHOLD:
                    fd['textured'] = True
                    speak("Please slowly turn your head left or right.")
                else:
                    reason = "SCREEN / PHONE DETECTED" if m >= config.MOIRE_THRESHOLD else "PHOTO DETECTED"
                    self._box(frame, ol,ot,or_,ob, RED, reason, "")
                    self._status(f"⚠   SPOOF: {reason} — USE YOUR REAL FACE", RED)
                    speak("Please stand directly in front of camera with your real face.",
                          key="spoof", cd=6)
                    continue

            # ── STEP 2: Head Turn ─────────────────────────
            if not fd['turned']:
                self._set_steps(1)
                y = calc_yaw(lm)
                fd['yaw_h'].append(y)
                if len(fd['yaw_h']) > 20: fd['yaw_h'].pop(0)
                rng = max(fd['yaw_h']) - min(fd['yaw_h'])
                if rng > config.POSE_YAW_THRESHOLD:
                    fd['turned'] = True
                    speak("Good. Now please blink your eyes once.")
                else:
                    self._box(frame, ol,ot,or_,ob, YELLOW, "TURN HEAD SLOWLY", "")
                    self._status("↔   SLOWLY TURN YOUR HEAD LEFT OR RIGHT", YELLOW)
                    speak("Please turn your head slightly left or right.",
                          key=f"turn_{fid}", cd=5)
                    continue

            # ── STEP 3: Blink ─────────────────────────────
            if not fd['blinked']:
                self._set_steps(2)
                e = (calc_ear(lm['left_eye']) + calc_ear(lm['right_eye'])) / 2.0
                if e < config.EYE_AR_THRESHOLD:
                    fd['blinked'] = True
                    fd['live']    = True
                    speak("Liveness verified. Scanning your face now.")
                else:
                    self._box(frame, ol,ot,or_,ob, YELLOW, "BLINK YOUR EYES", "")
                    self._status("👁   PLEASE BLINK YOUR EYES ONCE", YELLOW)
                    speak("Please blink your eyes once.",
                          key=f"blink_{fid}", cd=5)
                    continue

            # ── STEP 4: Face Match ────────────────────────
            if fd['live']:
                self._set_steps(3)
                self._status("🔍   SCANNING — PLEASE HOLD STILL", BLUE)
                if fd['frames'] < config.VALIDATION_FRAMES:
                    ds = face_recognition.face_distance(self.enc, enc)
                    if len(ds):
                        bi = int(np.argmin(ds))
                        if ds[bi] < config.MATCH_THRESHOLD:
                            fd['label']  = self.ids[bi]
                            fd['frames'] += 1
                        else:
                            fd['label']  = 'unknown'
                            fd['frames'] = 0
                self._box(frame, ol,ot,or_,ob, BLUE,
                          f"SCANNING {fd['frames']}/{config.VALIDATION_FRAMES}", "")

            # ── MARK ATTENDANCE ───────────────────────────
            if fd['frames'] >= config.VALIDATION_FRAMES and not fd['marked']:
                uid = fd['label']

                if uid == 'unknown':
                    fd['marked'] = True
                    speak("Face not registered. Please contact admin.")
                    self._show_ov(RED, '❌', 'NOT REGISTERED', '',
                                  'Your face is not found in the system.\nPlease contact HR or Admin.')
                    return

                cd_ok = time.time() - user_cooldowns.get(uid, 0) > (config.COOLDOWN_MINUTES * 60)
                if not cd_ok:
                    fd['marked'] = True
                    name = user_names.get(uid, 'Employee')
                    speak(f"Please wait 5 minutes {name}. Your attendance is already recorded.")
                    self._show_ov(ORANGE, '⏳', 'PLEASE WAIT', name,
                                  'Your attendance is already recorded.\nPlease wait 5 minutes for checkout.')
                    return

                result = mark_attendance(uid)
                if result:
                    user_cooldowns[uid] = time.time()
                    fd['marked'] = True
                    self._handle_result(result, uid)
                else:
                    speak("Server error. Please try again.")
                    self._status("❌   SERVER ERROR — PLEASE TRY AGAIN", RED)

        # Remove faces not seen for 3 seconds
        self.faces = {k: v for k, v in self.faces.items()
                      if time.time() - v['ts'] < 3}

    # ─────────────────────────────────────────────────────────
    #  HANDLE API RESULT → CHOOSE OVERLAY
    # ─────────────────────────────────────────────────────────
    def _handle_result(self, res, uid):
        action = res.get('action', '')
        name   = res.get('employeeName', user_names.get(uid, 'Employee'))
        msg    = res.get('message', '')
        cin    = res.get('checkInTime',  '')
        cout   = res.get('checkOutTime', '')

        if action == 'checkin':
            speak(f"Welcome {name}. You are checked in. Have a great shift.")
            detail = f"Check-In Time:  {cin}" if cin else "Have a great shift!"
            self._show_ov(GREEN, '✅', 'WELCOME!', name, detail)

        elif action == 'checkout':
            speak(f"Goodbye {name}. You are checked out. See you next time.")
            detail = f"Check-Out Time:  {cout}" if cout else "See you next time!"
            self._show_ov(BLUE, '👋', 'GOODBYE!', name, detail)

        elif action == 'completed':
            speak(f"{name}, your shift for today is already complete. See you tomorrow.")
            self._show_ov(PURPLE, '🏁', 'SHIFT COMPLETE', name,
                          f"{name}, your shift for today is already completed.\nSee you tomorrow!")

        elif action == 'none':
            speak(f"{name}, your shift has not started yet. Please wait.")
            self._show_ov(ORANGE, '🕐', 'SHIFT NOT STARTED', name,
                          'Your shift has not started yet.\nPlease wait for your shift to begin.')

        elif action == 'already_marked':
            speak(f"Please wait 5 minutes {name}. Your attendance is already recorded.")
            self._show_ov(ORANGE, '⏳', 'ALREADY RECORDED', name,
                          'Your attendance is already recorded.\nPlease wait 5 minutes before checking out.')
        else:
            txt = msg or "Please try again."
            speak(txt)
            self._show_ov(ORANGE, '⚠️', 'NOTICE', name, txt)

    # ─────────────────────────────────────────────────────────
    #  OVERLAY
    # ─────────────────────────────────────────────────────────
    def _show_ov(self, bg, icon, title, name, detail):
        for w in [self.ov, self.ov_icon, self.ov_title,
                  self.ov_name, self.ov_msg, self.ov_time,
                  self.pb.master]:
            w.configure(bg=bg)
        self.pb.configure(bg=bg)
        self.ov_icon.config(text=icon)
        self.ov_title.config(text=title, fg=WHITE)
        self.ov_name.config(text=name.upper() if name else '', fg=WHITE)
        self.ov_msg.config(text=detail, fg='#eeeeee')
        self.ov_time.config(text=datetime.now().strftime("🕐  %I:%M %p"), fg='#cccccc')
        self.overlay_until = time.time() + OVERLAY_SECS
        self.cam_canvas.pack_forget()
        self.ov.pack(fill='both', expand=True)

    def _hide_ov(self):
        self.ov.pack_forget()
        self.cam_canvas.pack(fill='both', expand=True)
        self._status("👤  PLEASE STAND IN FRONT OF THE CAMERA", GREEN)
        self._set_steps(-1)

    def _draw_pb(self, rem):
        w = self.pb.winfo_width()
        if w < 2: return
        bg = self.ov.cget('bg')
        self.pb.delete('all')
        self.pb.configure(bg=bg)
        filled = max(0, int(w * rem / OVERLAY_SECS))
        self.pb.create_rectangle(0, 0, w,  14, fill='#00000044', outline='')
        self.pb.create_rectangle(0, 0, filled, 14, fill='white',   outline='')

    # ─────────────────────────────────────────────────────────
    #  RENDER CAMERA FRAME
    # ─────────────────────────────────────────────────────────
    def _render(self, frame):
        cw = self.cam_canvas.winfo_width()
        ch = self.cam_canvas.winfo_height()
        if cw < 2 or ch < 2:
            return
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb).resize((cw, ch), Image.LANCZOS)

        # Face guide oval + corner brackets
        draw = ImageDraw.Draw(img)
        cx, cy = cw // 2, ch // 2
        rw, rh = int(cw * 0.20), int(ch * 0.44)
        ov_col = '#00C853'
        draw.ellipse([cx-rw, cy-rh, cx+rw, cy+rh], outline=ov_col, width=3)
        # Corner guides
        for px, py, sx, sy in [
            (cx-rw-18, cy-rh-18,  1,  1),
            (cx+rw+18, cy-rh-18, -1,  1),
            (cx-rw-18, cy+rh+18,  1, -1),
            (cx+rw+18, cy+rh+18, -1, -1),
        ]:
            draw.line([(px, py), (px+sx*28, py)],        fill=ov_col, width=3)
            draw.line([(px, py), (px, py+sy*28)],        fill=ov_col, width=3)

        self.photo = ImageTk.PhotoImage(img)
        self.cam_canvas.create_image(0, 0, anchor='nw', image=self.photo)

    # ─────────────────────────────────────────────────────────
    #  HELPERS
    # ─────────────────────────────────────────────────────────
    def _box(self, frame, l, t, r, b, col, status, name):
        c = hex2bgr(col)
        cv2.rectangle(frame, (l,t), (r,b), c, 2)
        if name:
            cv2.putText(frame, name,   (l, t-32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, c, 2)
        cv2.putText(frame, status, (l, b+30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, c, 2)

    def _status(self, txt, col=GREEN):
        self.lbl_status.config(text=txt, fg=col)

    def _set_steps(self, active):
        """Highlight steps 0..active in green, rest grey. -1 = all grey."""
        for i, (dot, lbl) in enumerate(self.step_labels):
            if i < active:
                dot.config(fg=GREEN)
                lbl.config(fg=GREEN)
            elif i == active:
                dot.config(fg=YELLOW)
                lbl.config(fg=YELLOW)
            else:
                dot.config(fg=DGRAY)
                lbl.config(fg=LGRAY)

    def shutdown(self):
        if self.cap:
            self.cap.release()
        self.root.destroy()

# ══════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════
def main():
    print("╔══════════════════════════════════════════╗")
    print("║   ZERO-SPOOF BIOMETRIC KIOSK  v3.0      ║")
    print("╚══════════════════════════════════════════╝")

    speak("Biometric attendance system is starting. Please wait.")

    enc, ids = get_employees()
    if not enc:
        speak("Cannot connect to server. Please contact admin.")
        input("❌  No employee data. Press Enter to exit...")
        return

    speak("System is ready. Please stand in front of the camera.")

    root = tk.Tk()
    app  = KioskApp(root, enc, ids)
    root.mainloop()

if __name__ == "__main__":
    main()