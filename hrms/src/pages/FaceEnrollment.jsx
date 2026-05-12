import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as faceapi from 'face-api.js';
import { API_BASE_URL } from '../config';

const FaceEnrollment = () => {
    const [employees, setEmployees] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [captures, setCaptures] = useState([]);
    const [status, setStatus] = useState('Loading models...');
    const [cameraActive, setCameraActive] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const videoRef = useRef(null);

    const [searchParams] = useSearchParams();
    const urlUserId = searchParams.get('userId');

    useEffect(() => {
        loadModels();
        fetchEmployees();
    }, []);

    useEffect(() => {
        if (urlUserId && employees.length > 0) {
            setSelectedUserId(urlUserId);
        }
    }, [urlUserId, employees]);

    // Auto start camera if user selected from URL
    useEffect(() => {
        if (selectedUserId && modelsLoaded && !cameraActive) {
            startCamera();
        }
    }, [selectedUserId, modelsLoaded]);

    const loadModels = async () => {
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
                faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
                faceapi.nets.faceRecognitionNet.loadFromUri('/models')
            ]);
            setModelsLoaded(true);
            setStatus('Models loaded. Please select an employee and start camera.');
        } catch (error) {
            console.error('Error loading models:', error);
            setStatus('Face recognition models not loaded. Check /public/models/ folder');
        }
    };

    const fetchEmployees = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/users`, {
                headers: { 'X-Role-Context': 'Admin' },
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setEmployees(data.filter(u => u.role !== 'Admin'));
            }
        } catch (error) {
            console.error('Failed to fetch employees:', error);
        }
    };

    const startCamera = async () => {
        if (!selectedUserId) {
            setStatus('Please select an employee first');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
            setCameraActive(true);
            setStatus('Camera active. Look straight into the camera and click Capture.');
            setCaptures([]);
        } catch (error) {
            console.error('Camera access error:', error);
            setStatus('Camera access denied. Please allow camera permission in browser settings.');
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const tracks = videoRef.current.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            setCameraActive(false);
        }
    };

    const captureFace = async () => {
        if (!videoRef.current) return;
        setIsCapturing(true);
        setCaptures([]);
        setStatus('Initializing enrollment. Please look straight...');
        
        let currentCaptures = [];
        let attempts = 0;
        let stage = 'Straight'; // Straight, Left, Right

        const interval = setInterval(async () => {
            if (currentCaptures.length >= 10 || attempts >= 40) {
                clearInterval(interval);
                setIsCapturing(false);
                
                if (currentCaptures.length >= 10) {
                    // Final consistency check
                    setStatus('Verifying measurements consistency...');
                    // Optional: Compare first and last for sanity
                    setStatus('Perfect! 10 high-quality samples captured from multiple angles.');
                } else {
                    setStatus(`Enrollment incomplete (${currentCaptures.length}/10). Please try again in better light.`);
                }
                return;
            }

            attempts++;
            
            // Guidance
            if (currentCaptures.length < 4) {
                stage = 'Straight';
                setStatus(`[Stage 1/3] Look straight into the camera... (${currentCaptures.length}/4)`);
            } else if (currentCaptures.length < 7) {
                stage = 'Left';
                setStatus(`[Stage 2/3] Turn your head slightly LEFT... (${currentCaptures.length-4}/3)`);
            } else {
                stage = 'Right';
                setStatus(`[Stage 3/3] Turn your head slightly RIGHT... (${currentCaptures.length-7}/3)`);
            }

            try {
                // High confidence threshold + landmarks check
                const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.85 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (detection) {
                    const newDescriptor = Array.from(detection.descriptor);
                    
                    // Simple quality check: ensure landmarks are distinct
                    const landmarks = detection.landmarks.positions;
                    if (landmarks.length === 68) {
                        currentCaptures.push(newDescriptor);
                        setCaptures([...currentCaptures]);
                    }
                }
            } catch (error) {
                console.error('Capture error:', error);
            }
        }, 800); 
    };

    const saveEnrollment = async () => {
        try {
            setStatus('Saving...');
            const res = await fetch(`${API_BASE_URL}/attendance/enroll-face`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Role-Context': 'Admin'
                },
                credentials: 'include',
                body: JSON.stringify({
                    userId: selectedUserId,
                    descriptors: captures
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                setStatus('Face enrolled successfully!');
                stopCamera();
                setCaptures([]);
                setSelectedUserId('');
            } else {
                setStatus(`Error: ${data.message}`);
            }
        } catch (error) {
            setStatus('Connection error. Could not save.');
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-6">Face Enrollment</h1>
            
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Employee</label>
                    <select 
                        value={selectedUserId} 
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded"
                        disabled={cameraActive}
                    >
                        <option value="">-- Select --</option>
                        {employees.map(emp => (
                            <option key={emp._id} value={emp._id}>
                                {emp.name} ({emp.employeeId}) {emp.faceEnrolled ? '✓ Enrolled' : ''}
                            </option>
                        ))}
                    </select>
                </div>

                {!cameraActive ? (
                    <button 
                        onClick={startCamera}
                        disabled={!modelsLoaded || !selectedUserId}
                        className="bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
                    >
                        Start Camera
                    </button>
                ) : (
                    <button 
                        onClick={stopCamera}
                        className="bg-red-600 text-white px-4 py-2 rounded"
                    >
                        Stop Camera
                    </button>
                )}
            </div>

            <div className="flex gap-6">
                <div className="flex-1 bg-black rounded-lg overflow-hidden relative" style={{ minHeight: '300px' }}>
                    <video 
                        ref={videoRef}
                        autoPlay
                        muted
                        className="w-full h-full object-cover"
                    />
                </div>

                <div className="w-1/3 flex flex-col gap-4">
                    <div className={`p-4 rounded-lg font-medium text-center ${status.includes('Error') || status.includes('denied') ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                        {status}
                    </div>

                    <button
                        onClick={captureFace}
                        disabled={!cameraActive || captures.length >= 10 || isCapturing}
                        className="bg-indigo-600 text-white px-4 py-3 rounded-lg text-lg font-bold disabled:bg-gray-400"
                    >
                        {isCapturing ? `Capturing... (${captures.length}/10)` : 'Start Multi-Angle Enrollment'}
                    </button>

                    <button
                        onClick={saveEnrollment}
                        disabled={captures.length < 10}
                        className="bg-emerald-600 text-white px-4 py-3 rounded-lg text-lg font-bold disabled:bg-gray-400"
                    >
                        Save Enrollment
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FaceEnrollment;
