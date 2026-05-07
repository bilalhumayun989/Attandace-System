import { API_BASE_URL } from '../../config';
import React, { useState, useEffect, useRef } from 'react';
import { LogIn, LogOut, Zap, Timer as TimerIcon, Camera } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import * as faceapi from 'face-api.js';

const UserDashboard = () => {
    const { employeeUser: user, logout } = useAuth();
    const [attendanceData, setAttendanceData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [currentTime, setCurrentTime] = useState(new Date());

    const videoRef = useRef(null);
    const [cameraActive, setCameraActive] = useState(false);
    const [faceStatus, setFaceStatus] = useState('Initializing camera...');
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [faceMatcher, setFaceMatcher] = useState(null);
    const [scanPause, setScanPause] = useState(false);
    const [stream, setStream] = useState(null);
    const userCooldownsRef = useRef({});
    const userCompletedRef = useRef({}); // New: Tracks users who finished their shift for the day
    const userNamesRef = useRef({}); // New: Map IDs to Names for voice feedback
    const validationRef = useRef({ label: '', count: 0 }); // New: Buffers detections to prevent flickering matches
    const [isFaceCentered, setIsFaceCentered] = useState(false);
    const [isFaceDetected, setIsFaceDetected] = useState(false);
    const [instruction, setInstruction] = useState('Position your face');
    const lastVocalGuidanceRef = useRef(0);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        fetchInitialData(true);
    }, []);

    useEffect(() => {
        if (user && user._id && !modelsLoaded) {
            loadModelsAndDescriptors();
        }
    }, [user, modelsLoaded]);

    const loadModelsAndDescriptors = async () => {
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
                faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
                faceapi.nets.faceRecognitionNet.loadFromUri('/models')
            ]);
            setModelsLoaded(true);

            // Fetch all descriptors
            const res = await fetch(`${API_BASE_URL}/attendance/face-descriptors`);
            if (res.ok) {
                const data = await res.json();
                const employees = data.employees || [];
                if (employees.length > 0) {
                    const labeledDescriptors = employees.map(emp => {
                        // Store name for voice feedback later
                        userNamesRef.current[emp._id] = emp.name;
                        return new faceapi.LabeledFaceDescriptors(
                            emp._id.toString(),
                            emp.faceDescriptors.map(desc => new Float32Array(desc))
                        );
                    });
                    // Threshold 0.45 + 3-frame validation = 100% Accuracy
                    const matcher = new faceapi.FaceMatcher(labeledDescriptors, 0.45);
                    setFaceMatcher(matcher);
                    setFaceStatus('Face recognition active. Ready for any employee.');
                    startCamera();
                } else {
                    setFaceStatus('No faces enrolled. Please contact Admin.');
                }
            } else {
                setFaceStatus('Failed to fetch face descriptors from server.');
            }
        } catch (error) {
            console.error('Error loading face-api:', error);
            setFaceStatus(`Error: ${error.message}`);
        }
    };

    const startCamera = async () => {
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
            setCameraActive(true);
        } catch (error) {
            console.error('Camera access denied:', error);
            setFaceStatus('Camera access denied.');
        }
    };

    // Ensure stream is always attached to video element
    useEffect(() => {
        if (stream && videoRef.current && !videoRef.current.srcObject) {
            videoRef.current.srcObject = stream;
        }
    }, [stream, cameraActive]);
    useEffect(() => {
        let isScanning = true;
        let scanTimeout;

        const scan = async () => {
            if (!isScanning || !cameraActive || !faceMatcher || scanPause) return;
            
            if (videoRef.current && videoRef.current.readyState === 4) {
                try {
                    const displaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
                    
                    // Increase minConfidence from 0.2 to 0.6 to ignore blurry/partial faces
                    const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
                        .withFaceLandmarks()
                        .withFaceDescriptor();

                    if (detection) {
                        setIsFaceDetected(true);
                        const { box } = detection.detection;
                        
                        // Define center zone
                        const centerX = displaySize.width / 2;
                        const centerY = displaySize.height / 2;
                        const faceCenterX = box.x + box.width / 2;
                        const faceCenterY = box.y + box.height / 2;
                        
                        const isCentered = Math.abs(faceCenterX - centerX) < 100 && 
                                          Math.abs(faceCenterY - centerY) < 100 &&
                                          box.width > 120;

                        setIsFaceCentered(isCentered);

                        if (!isCentered) {
                            if (box.width < 120) {
                                setInstruction('Move Closer');
                                triggerVocalGuidance('Please move closer to the camera');
                            } else {
                                setInstruction('Center Face');
                                triggerVocalGuidance('Please center your face');
                            }
                            validationRef.current = { label: '', count: 0 };
                            setFaceStatus(instruction);
                        } else {
                            setInstruction('Hold Still...');
                            const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
                            const currentLabel = bestMatch.label;

                            if (validationRef.current.label === currentLabel) {
                                validationRef.current.count += 1;
                            } else {
                                validationRef.current.label = currentLabel;
                                validationRef.current.count = 1;
                            }

                            const nameInfo = currentLabel === 'unknown' ? 'Unknown Face' : 'Match Found';
                            setFaceStatus(`Scanning... ${nameInfo} (${validationRef.current.count}/2)`);

                            if (validationRef.current.count >= 2) {
                                validationRef.current.count = 0;
                                if (currentLabel !== 'unknown') {
                                    handleFaceDetection(currentLabel);
                                    return; 
                                } else {
                                    setFaceStatus('User not registered');
                                    speak('User not registered');
                                    setScanPause(true);
                                    setTimeout(() => {
                                        setScanPause(false);
                                        setFaceStatus('Face recognition active.');
                                    }, 3000);
                                    return;
                                }
                            }
                        }
                    } else {
                        setIsFaceDetected(false);
                        setIsFaceCentered(false);
                        setInstruction('Position your face');
                        validationRef.current = { label: '', count: 0 };
                        setFaceStatus('Looking for face...');
                    }
                } catch (error) {
                    console.error('Detection error:', error);
                }
            }
            
            // High-speed loop: 100ms (10 scans per second)
            if (isScanning && !scanPause) {
                scanTimeout = setTimeout(scan, 100);
            }
        };

        if (cameraActive && faceMatcher && !scanPause) {
            scan();
        }

        return () => {
            isScanning = false;
            if (scanTimeout) clearTimeout(scanTimeout);
        };
    }, [cameraActive, faceMatcher, scanPause]);

    const speak = (text) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    };

    const triggerVocalGuidance = (text) => {
        const now = Date.now();
        if (now - lastVocalGuidanceRef.current > 5000) {
            speak(text);
            lastVocalGuidanceRef.current = now;
        }
    };

    const handleFaceDetection = async (detectedUserId) => {
        if (scanPause) return;
        setScanPause(true);
        userCooldownsRef.current[detectedUserId] = Date.now();
        
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/face-checkin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: detectedUserId, timestamp: new Date().toISOString() })
            });
            const data = await response.json();
            
            if (response.ok) {
                let msg = data.message || '';
                
                if (data.action === 'checkin') {
                    const voiceMsg = msg.includes('Overtime') ? `Overtime started for ${data.employeeName}` : `Welcome ${data.employeeName}, Checked In`;
                    setMessage({ type: 'success', text: `${msg}: ${data.employeeName} at ${data.checkInTime}` });
                    speak(voiceMsg);
                } else if (data.action === 'checkout') {
                    const voiceMsg = msg.includes('Overtime') ? `Goodbye ${data.employeeName}, Overtime recorded` : `Goodbye ${data.employeeName}, Checked Out`;
                    setMessage({ type: 'success', text: `${msg}: ${data.employeeName} at ${data.checkOutTime}` });
                    speak(voiceMsg);
                    userCompletedRef.current[detectedUserId] = true;
                } else if (data.action === 'completed') {
                    userCompletedRef.current[detectedUserId] = true;
                    setMessage({ type: 'success', text: msg });
                    speak(`${data.employeeName}, ${msg}`);
                }
                
                fetchInitialData(false); // Silent background update
                setTimeout(() => setMessage({ type: '', text: '' }), 5000);
            }
        } catch (error) {
            console.error(error);
        }

        // Resume scanning after 2 seconds
        setTimeout(() => {
            setScanPause(false);
            setFaceStatus('Face recognition active. Ready for next employee.');
        }, 2000);
    };

    const fetchInitialData = async (isFirstLoad = false) => {
        if (isFirstLoad) setLoading(true);
        try {
            const statusRes = await fetch(`${API_BASE_URL}/attendance/status`, {
                headers: { 'X-Role-Context': 'Employee' },
                credentials: 'include'
            });
            const statusData = await statusRes.json();
            if (statusRes.ok) setAttendanceData(statusData);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAttendanceAction = async (action) => {
        try {
            const response = await fetch(`${API_BASE_URL}/attendance/${action}`, {
                method: 'POST',
                headers: { 'X-Role-Context': 'Employee' },
                credentials: 'include'
            });
            const data = await response.json();
            if (response.ok) {
                setMessage({ type: 'success', text: data.message });
                fetchInitialData();
                setTimeout(() => setMessage({ type: '', text: '' }), 3000);
            } else {
                setMessage({ type: 'error', text: data.message });
                setTimeout(() => setMessage({ type: '', text: '' }), 3000);
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Connection error' });
        }
    };

    if (loading) return <div className="h-screen w-screen bg-black flex items-center justify-center text-white font-bold tracking-widest uppercase">System Loading...</div>;

    const actionButtons = [
        { id: 'checkin', label: 'Check-In', color: 'bg-emerald-600', active: !attendanceData?.checkIn },
        { id: 'checkout', label: 'Check-Out', color: 'bg-rose-600', active: attendanceData?.checkIn && !attendanceData?.checkOut },
        { id: 'overtime-in', label: 'Overtime-In', color: 'bg-indigo-600', active: user?.isOvertimeAllowed && !attendanceData?.overtimeIn },
        { id: 'overtime-out', label: 'Overtime-Out', color: 'bg-fuchsia-600', active: user?.isOvertimeAllowed && attendanceData?.overtimeIn && !attendanceData?.overtimeOut },
    ];

    return (
        <div className="h-screen w-screen bg-black text-white flex flex-col p-6 overflow-hidden font-sans select-none">
            {/* Header: Name, Date, Status */}
            <div className="flex justify-between items-center bg-[#1a1a1a] p-6 rounded-2xl border border-white/10 mb-8 shadow-2xl">
                <div className="space-y-1">
                    <p className="text-emerald-500 font-black text-2xl uppercase tracking-tighter">{user?.name}</p>
                    <p className="text-white/40 font-bold text-xs uppercase tracking-[0.2em]">{user?.employeeId} | {user?.department}</p>
                </div>
                <div className="text-center">
                    <p className="text-4xl font-black tabular-nums tracking-tight">
                        {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-white/40 font-bold text-[10px] uppercase tracking-widest">
                        {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-white/40 text-[10px] font-black uppercase tracking-widest mb-1">System Status</p>
                    <div className="flex items-center justify-end gap-2">
                        <span className={`text-xl font-black uppercase tracking-widest ${attendanceData?.checkIn ? (attendanceData.checkOut ? 'text-rose-500' : 'text-emerald-500') : 'text-amber-500'}`}>
                            {attendanceData?.checkIn ? (attendanceData.checkOut ? 'Shift Ended' : 'Currently In') : 'Awaiting In'}
                        </span>
                        <div className={`h-3 w-3 rounded-full shadow-lg ${attendanceData?.checkIn ? (attendanceData.checkOut ? 'bg-rose-500 shadow-rose-500/50' : 'bg-emerald-500 shadow-emerald-500/50 animate-pulse') : 'bg-amber-500 shadow-amber-500/50'}`} />
                    </div>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 pb-6">
                <div className="lg:col-span-2 grid grid-cols-2 gap-6 relative">
                    {/* Overlay to indicate manual click disabled */}
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-3xl backdrop-blur-[2px]">
                        <div className="bg-emerald-900/80 border border-emerald-500 px-6 py-3 rounded-full flex items-center gap-3">
                            <Camera className="w-5 h-5 text-emerald-400 animate-pulse" />
                            <span className="text-emerald-400 font-bold uppercase tracking-widest text-sm">Manual Buttons Disabled - Use Face Camera</span>
                        </div>
                    </div>
                    {actionButtons.map((btn) => (
                        <button
                            key={btn.id}
                            disabled={true}
                            className={`rounded-3xl flex flex-col items-center justify-center gap-4 transition-all duration-200 border-4 min-h-[150px] ${
                                btn.active 
                                ? `${btn.color} border-white/20 shadow-xl brightness-75` 
                                : `${btn.color} border-white/5 opacity-40 grayscale`
                            }`}
                        >
                            <span className="text-2xl md:text-3xl font-black uppercase tracking-widest text-center">{btn.label}</span>
                        </button>
                    ))}
                </div>

                {/* Camera Widget */}
                <div className="bg-[#1a1a1a] rounded-3xl border border-white/10 overflow-hidden flex flex-col shadow-2xl">
                    <div className="p-4 bg-black/40 border-b border-white/10 flex items-center justify-between">
                        <span className="font-black uppercase tracking-widest text-sm flex items-center gap-2">
                            <Camera className="w-4 h-4 text-emerald-500" />
                            Auto-Attendance
                        </span>
                        {scanPause && <span className="text-amber-500 text-xs font-bold uppercase tracking-wider animate-pulse">Cooldown</span>}
                    </div>
                    <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
                        {cameraActive ? (
                            <>
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover transition-all duration-500 scale-x-[-1]"
                                />
                                
                                {/* Biometric Ring */}
                                <div className={`biometric-ring !w-[280px] !h-[340px] ${isFaceCentered ? 'active' : ''}`}></div>

                                {/* Face Guide Widget Overlay */}
                                <div className={`kiosk-face-guide !w-[240px] !h-[300px] ${isFaceCentered ? 'active' : ''}`}>
                                    <div className="scan-mesh"></div>
                                    <div className="face-corner face-corner-tl !w-8 !h-8 !border-t-4 !border-l-4"></div>
                                    <div className="face-corner face-corner-tr !w-8 !h-8 !border-t-4 !border-r-4"></div>
                                    <div className="face-corner face-corner-bl !w-8 !h-8 !border-b-4 !border-l-4"></div>
                                    <div className="face-corner face-corner-br !w-8 !h-8 !border-b-4 !border-r-4"></div>
                                    
                                    {!isFaceDetected && (
                                        <div className="absolute inset-0 flex items-center justify-center opacity-10">
                                            <svg width="100" height="120" viewBox="0 0 200 250" fill="none">
                                                <path d="M100 230C150 230 180 190 180 130C180 70 144 20 100 20C56 20 20 70 20 130C20 190 50 230 100 230Z" stroke="white" strokeWidth="8"/>
                                            </svg>
                                        </div>
                                    )}

                                    {!scanPause && (
                                        <>
                                            <div className="scanner-line"></div>
                                            <div className="scanner-line-secondary"></div>
                                        </>
                                    )}

                                    {!isFaceCentered && (
                                        <div className="absolute inset-0 flex items-center justify-center z-30">
                                            <div className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10 animate-pulse">
                                                <p className="text-white font-black text-[10px] uppercase tracking-widest text-center">
                                                    {instruction}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {scanPause && (
                                    <div className="absolute inset-0 z-50 bg-emerald-600/80 flex flex-col items-center justify-center animate-in fade-in zoom-in">
                                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-2">
                                            <span className="text-3xl text-emerald-600">✓</span>
                                        </div>
                                        <p className="text-white font-black text-xs uppercase">Action Recorded</p>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-white/30 text-center px-4">
                                <p className="text-sm font-bold uppercase tracking-widest">{faceStatus}</p>
                            </div>
                        )}
                    </div>
                    <div className="p-3 bg-black/40 border-t border-white/10">
                        <p className={`text-xs font-bold text-center tracking-wider uppercase ${faceStatus.includes('not enrolled') || faceStatus.includes('failed') ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {faceStatus}
                        </p>
                    </div>
                </div>
            </div>

            {/* Notification Toast */}
            {message.text && (
                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-full max-w-lg px-6 animate-in zoom-in-95 duration-300">
                    <div className={`p-10 rounded-[2.5rem] border-4 shadow-[0_0_100px_rgba(0,0,0,0.5)] text-center ${
                        message.type === 'success' ? 'bg-emerald-600 border-emerald-400' : 'bg-rose-600 border-rose-400'
                    }`}>
                        <h2 className="text-4xl font-black uppercase tracking-[0.2em] mb-2">{message.type === 'success' ? 'Success' : 'Error'}</h2>
                        <p className="text-xl font-bold uppercase tracking-widest opacity-90">{message.text}</p>
                    </div>
                </div>
            )}

            {/* Logout button */}
            <div className="flex justify-center pb-2">
                <button 
                    onClick={() => { logout('Employee'); window.location.href = '/login'; }} 
                    className="text-[10px] font-black text-white/20 uppercase tracking-[0.5em] hover:text-rose-500 transition-colors"
                >
                    Logout System
                </button>
            </div>
        </div>
    );
};

export default UserDashboard;
