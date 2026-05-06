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
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
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
            faceapi.draw.drawDetections(canvas, resizedDetections);

            for (const detection of resizedDetections) {
                const match = faceMatcherRef.current.findBestMatch(detection.descriptor);
                
                if (match.label !== 'unknown') {
                    const userId = match.label;
                    const now = Date.now();
                    
                    // 5-second cooldown
                    if (!cooldownRef.current[userId] || now - cooldownRef.current[userId] > 5000) {
                        cooldownRef.current[userId] = now;
                        processAttendance(userId);
                    }
                }
            }
        }, 800);
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
                    setStatusMessage(`${data.employeeName}, your attendance is already complete for today.`);
                    speak(`Hi ${data.employeeName}, your attendance is already complete for today`);
                }

                // Reset message after 4 seconds
                setTimeout(() => {
                    setStatusMessage('Looking for face...');
                    setStatusType('info');
                }, 4000);
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

            {/* Video Area */}
            <div className="flex-1 relative flex items-center justify-center bg-[#0a0a0a]">
                <div className="relative rounded-3xl overflow-hidden border-8 border-white/5 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                    <video
                        ref={videoRef}
                        onPlay={handleVideoPlay}
                        autoPlay
                        muted
                        className="w-[800px] max-w-full aspect-video object-cover"
                    />
                    <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 w-full h-full"
                    />
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
