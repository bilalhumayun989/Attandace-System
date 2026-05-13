import React, { useState, useEffect, useRef } from 'react';
import * as faceapi from 'face-api.js';
import { API_BASE_URL } from '../config';

const FaceKiosk = () => {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [statusMessage, setStatusMessage] = useState('Loading face recognition models...');
    const [statusType, setStatusType] = useState('info'); // info, success, warning
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const faceMatcherRef = useRef(null);
    const cooldownRef = useRef({});
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [isFaceCentered, setIsFaceCentered] = useState(false);
    const [isFaceDetected, setIsFaceDetected] = useState(false);
    const [instruction, setInstruction] = useState('Position your face in the circle');
    const lastVocalGuidanceRef = useRef(0);
    const consecutiveMatchCountRef = useRef(0);
    const lastMatchedUserIdRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        
        const init = async () => {
            try {
                await loadModels();
                await fetchDescriptors();
                startCamera();
            } catch (error) {
                setStatusMessage('Initialization failed. Check models or network.');
                setStatusType('warning');
            }
        };
        init();

        return () => {
            clearInterval(timer);
            stopCamera();
        };
    }, []);

    const loadModels = async () => {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('/models')
        ]);
        setModelsLoaded(true);
    };

    const fetchDescriptors = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/attendance/face-descriptors`);
            if (!res.ok) throw new Error('Failed to fetch descriptors');
            
            const data = await res.json();
            if (!data.employees || data.employees.length === 0) {
                setStatusMessage('No faces enrolled. Ask admin to enroll employees first.');
                setStatusType('warning');
                return;
            }

            const labeledDescriptors = data.employees.map(emp => {
                const descriptors = emp.faceDescriptors.map(d => new Float32Array(d));
                return new faceapi.LabeledFaceDescriptors(emp._id.toString(), descriptors);
            });

            faceMatcherRef.current = new faceapi.FaceMatcher(labeledDescriptors, 0.45);
            setStatusMessage('Looking for face...');
            setStatusType('info');
        } catch (error) {
            console.error('Error fetching descriptors:', error);
            setStatusMessage('Error loading employee faces.');
            setStatusType('warning');
        }
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (error) {
            setStatusMessage('Camera access denied. Please allow camera permission.');
            setStatusType('warning');
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }
    };

    const speak = (text) => {
        let utteranceText = text;
        
        // Handle dynamic messages
        if (text.includes('Welcome')) {
            const name = text.split('Welcome ')[1]?.split(',')[0] || '';
            if (text.includes('Overtime')) {
                utteranceText = `${name}, your overtime has started`;
            } else {
                utteranceText = `Welcome ${name}, you are checked in`;
            }
        } else if (text.includes('Goodbye')) {
            const name = text.split('Goodbye ')[1]?.split(',')[0] || '';
            if (text.includes('Overtime')) {
                utteranceText = `${name}, your overtime has been recorded`;
            } else {
                utteranceText = `Goodbye ${name}, you are checked out`;
            }
        } else if (text === 'shift time not start') {
            utteranceText = 'Shift time not started yet';
        } else if (text === 'wait 5 min you are already checked in') {
            utteranceText = 'Please wait 5 minutes, you are already checked in';
        } else if (text.includes('already complete')) {
            utteranceText = 'Your attendance is already complete for today';
        }

        const utterance = new SpeechSynthesisUtterance(utteranceText);
        utterance.rate = 0.95;
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
    };

    const triggerVocalGuidance = (text) => {
        const now = Date.now();
        // Limit vocal guidance to once every 4 seconds to avoid annoyance
        if (now - lastVocalGuidanceRef.current > 4000) {
            speak(text);
            lastVocalGuidanceRef.current = now;
        }
    };

    const handleVideoPlay = () => {
        if (!faceMatcherRef.current) return;

        const canvas = canvasRef.current;
        const displaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
        faceapi.matchDimensions(canvas, displaySize);

        setInterval(async () => {
            if (!videoRef.current) return;

            const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.SsdMobilenetv1Options())
                .withFaceLandmarks()
                .withFaceDescriptors();

            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw face recognition box (subtle)
            resizedDetections.forEach(det => {
                const { box } = det.detection;
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 2;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
            });

            if (resizedDetections.length > 0) {
                setIsFaceDetected(true);
                const detection = resizedDetections[0];
                const { box } = detection.detection;
                
                // Define center zone
                const centerX = displaySize.width / 2;
                const centerY = displaySize.height / 2;
                const faceCenterX = box.x + box.width / 2;
                const faceCenterY = box.y + box.height / 2;
                
                // Check if face is roughly centered and large enough
                const isCentered = Math.abs(faceCenterX - centerX) < 100 && 
                                  Math.abs(faceCenterY - centerY) < 100 &&
                                  box.width > 150;

                setIsFaceCentered(isCentered);

                if (!isCentered) {
                    if (box.width < 150) {
                        setInstruction('Move Closer');
                        triggerVocalGuidance('Please move closer to the camera');
                    } else {
                        setInstruction('Center Your Face');
                        triggerVocalGuidance('Please center your face in the circle');
                    }
                } else {
                    setInstruction('Hold Still...');
                    
                    const match = faceMatcherRef.current.findBestMatch(detection.descriptor);
                    
                    if (match.label !== 'unknown') {
                        const userId = match.label;
                        
                        // Reliability check: require 2 consecutive matches for the same person
                        if (lastMatchedUserIdRef.current === userId) {
                            consecutiveMatchCountRef.current += 1;
                        } else {
                            lastMatchedUserIdRef.current = userId;
                            consecutiveMatchCountRef.current = 1;
                        }

                        if (consecutiveMatchCountRef.current >= 2) {
                            const now = Date.now();
                            if (!cooldownRef.current[userId] || now - cooldownRef.current[userId] > 5000) {
                                cooldownRef.current[userId] = now;
                                processAttendance(userId);
                            }
                            // Reset count after processing
                            consecutiveMatchCountRef.current = 0;
                        } else {
                            setInstruction('Verifying...');
                        }
                    } else {
                        setInstruction('Face Not Recognized');
                        lastMatchedUserIdRef.current = null;
                        consecutiveMatchCountRef.current = 0;
                    }
                }
            } else {
                setIsFaceDetected(false);
                setIsFaceCentered(false);
                setInstruction('Position your face in the circle');
            }
        }, 500);
    };

    const processAttendance = async (userId) => {
        try {
            const res = await fetch(`${API_BASE_URL}/attendance/face-checkin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    timestamp: new Date().toISOString()
                })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                setStatusType('success');
                if (data.action === 'checkin') {
                    const msg = `Welcome ${data.employeeName}! Checked In at ${data.checkInTime}`;
                    setStatusMessage(msg);
                    speak(`Welcome ${data.employeeName}, checked in at ${data.checkInTime}`);
                } else if (data.action === 'checkout') {
                    const msg = `Goodbye ${data.employeeName}! Checked Out. Hours: ${data.hoursWorked}`;
                    setStatusMessage(msg);
                    speak(`Goodbye ${data.employeeName}, you worked ${data.hoursWorked} hours today`);
                } else if (data.action === 'already_complete') {
                    setStatusType('warning');
                    const msg = `${data.employeeName}, your attendance is already complete for today.`;
                    setStatusMessage(msg);
                    speak(`Hi ${data.employeeName}, your attendance is already complete for today`);
                } else if (data.action === 'already_marked') {
                    setStatusType('warning');
                    setStatusMessage(data.message);
                    speak(`Hi ${data.employeeName}, ${data.message}`);
                } else if (data.action === 'none') {
                    setStatusType('warning');
                    setStatusMessage(data.message);
                    speak(data.message);
                }

                // Reset message after 5 seconds
                setTimeout(() => {
                    setStatusMessage('Looking for face...');
                    setStatusType('info');
                    setInstruction('Position your face in the circle');
                }, 5000);
            }
        } catch (error) {
            console.error('Attendance API error:', error);
        }
    };

    return (
        <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden font-sans select-none">
            {/* Header */}
            <div className="bg-[#111] p-6 border-b border-white/10 flex justify-between items-center shadow-xl z-10">
                <div>
                    <h1 className="text-3xl font-black uppercase tracking-widest text-emerald-500">Auto Attendance</h1>
                    <p className="text-white/40 font-bold uppercase tracking-widest text-sm mt-1">Biometric Kiosk</p>
                </div>
                <div className="text-right">
                    <p className="text-5xl font-black tabular-nums tracking-tighter">
                        {currentTime.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                    <p className="text-white/40 font-bold uppercase tracking-widest mt-1">
                        {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                </div>
            </div>

            <div className="flex-1 relative flex items-center justify-center bg-[#0a0a0a] p-4">
                <div className="relative rounded-[40px] overflow-hidden border-[12px] border-[#1a1a1a] shadow-[0_0_80px_rgba(0,0,0,0.8)] aspect-video h-[70vh]">
                    <video
                        ref={videoRef}
                        onPlay={handleVideoPlay}
                        autoPlay
                        muted
                        className="h-full w-full object-cover scale-x-[-1]"
                    />
                    
                    {/* Success/Error Overlay */}
                    {statusType === 'success' && (
                        <div className="absolute inset-0 z-50 bg-emerald-600/90 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                            <div className="w-48 h-48 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl animate-bounce">
                                <span className="text-9xl text-emerald-600">✓</span>
                            </div>
                            <h2 className="text-7xl font-black text-white uppercase text-center px-4 leading-tight">
                                {statusMessage.split('!')[0]}!
                            </h2>
                            <p className="text-3xl font-bold text-white/80 mt-4 bg-black/20 px-8 py-3 rounded-full">
                                {statusMessage.split('!')[1]}
                            </p>
                        </div>
                    )}

                    {/* Biometric Progress Ring */}
                    <div className={`biometric-ring ${isFaceCentered ? 'active' : ''}`}></div>

                    {/* Face Guide Overlay */}
                    <div className={`kiosk-face-guide ${isFaceCentered ? 'active' : ''}`}>
                        {/* Digital Mesh Effect */}
                        <div className="scan-mesh"></div>

                        <div className="face-corner face-corner-tl"></div>
                        <div className="face-corner face-corner-tr"></div>
                        <div className="face-corner face-corner-bl"></div>
                        <div className="face-corner face-corner-br"></div>
                        
                        {/* Silhouette Placeholder (Visible when no face detected) */}
                        {!isFaceDetected && (
                            <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                <svg width="200" height="250" viewBox="0 0 200 250" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M100 230C150 230 180 190 180 130C180 70 144 20 100 20C56 20 20 70 20 130C20 190 50 230 100 230Z" stroke="white" strokeWidth="4"/>
                                    <path d="M60 110C60 110 70 100 80 100" stroke="white" strokeWidth="4" strokeLinecap="round"/>
                                    <path d="M140 110C140 110 130 100 120 100" stroke="white" strokeWidth="4" strokeLinecap="round"/>
                                    <path d="M80 170C80 170 90 180 100 180C110 180 120 170 120 170" stroke="white" strokeWidth="4" strokeLinecap="round"/>
                                </svg>
                            </div>
                        )}

                        {/* Scanning Lines (Heavy) */}
                        <div className="scanner-line"></div>
                        <div className="scanner-line-secondary"></div>
                        
                        {/* Center Instruction Overlay */}
                        {!isFaceCentered && (
                            <div className="absolute inset-0 flex items-center justify-center z-30">
                                <div className="bg-black/60 backdrop-blur-sm px-8 py-4 rounded-full border border-white/10 shadow-2xl animate-pulse">
                                    <p className="text-white font-black text-2xl uppercase tracking-[0.2em] flex items-center gap-3">
                                        <span className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
                                        {instruction}
                                    </p>
                                </div>
                            </div>
                        )}
                        
                        {isFaceCentered && (
                            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30">
                                <div className="bg-emerald-500/20 backdrop-blur-md px-6 py-2 rounded-full border border-emerald-500/50">
                                    <p className="text-emerald-400 font-black text-sm uppercase tracking-[0.3em] animate-pulse">
                                        AI SCANNING...
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Orbital High-Tech Elements */}
                    <div className="orbital-ring">
                        <div className="orbital-data"></div>
                    </div>
                    <div className="orbital-ring !w-[600px] !h-[600px] opacity-30">
                        <div className="orbital-data orbital-slow orbital-reverse"></div>
                    </div>

                    {/* Canvas for technical debugging (optional, can be hidden) */}
                    <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-30"
                    />

                    {/* Status Glow */}
                    <div className={`absolute inset-0 pointer-events-none transition-opacity duration-500
                        ${statusType === 'success' ? 'bg-emerald-500/10 opacity-100' : 'opacity-0'}
                    `}></div>
                </div>

                {/* Side Instructions */}
                <div className="absolute left-10 top-1/2 -translate-y-1/2 hidden xl:flex flex-col gap-8 w-64">
                    <div className="bg-[#111] p-6 rounded-3xl border border-white/5">
                        <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-4">
                            <span className="text-2xl">👤</span>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">Step 1</h3>
                        <p className="text-white/40 text-sm">Look directly into the camera lens</p>
                    </div>
                    <div className="bg-[#111] p-6 rounded-3xl border border-white/5">
                        <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-4">
                            <span className="text-2xl">⭕</span>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">Step 2</h3>
                        <p className="text-white/40 text-sm">Keep your face inside the circle</p>
                    </div>
                    <div className="bg-[#111] p-6 rounded-3xl border border-white/5">
                        <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-4">
                            <span className="text-2xl">⏱️</span>
                        </div>
                        <h3 className="text-lg font-bold text-white mb-1">Step 3</h3>
                        <p className="text-white/40 text-sm">Wait for the green light and sound</p>
                    </div>
                </div>
            </div>

            {/* Footer Status */}
            <div className={`p-8 border-t-4 transition-colors duration-300 text-center z-10
                ${statusType === 'success' ? 'bg-emerald-900/30 border-emerald-500' : ''}
                ${statusType === 'warning' ? 'bg-amber-900/30 border-amber-500' : ''}
                ${statusType === 'info' ? 'bg-[#111] border-blue-500' : ''}
            `}>
                <h2 className={`text-4xl md:text-5xl font-black uppercase tracking-widest 
                    ${statusType === 'success' ? 'text-emerald-400' : ''}
                    ${statusType === 'warning' ? 'text-amber-400' : ''}
                    ${statusType === 'info' ? 'text-blue-400' : ''}
                `}>
                    {statusMessage}
                </h2>
            </div>
        </div>
    );
};

export default FaceKiosk;
