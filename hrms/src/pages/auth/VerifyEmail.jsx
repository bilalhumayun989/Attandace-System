import { API_BASE_URL } from '../../config';
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, ArrowRight, ShieldCheck, MailCheck } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card';

const VerifyEmail = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('idle'); // idle, loading, success, error
    const [message, setMessage] = useState('');
    const [countdown, setCountdown] = useState(3);

    const handleVerify = async () => {
        if (!token) {
            setStatus('error');
            setMessage('No verification token provided.');
            return;
        }

        setStatus('loading');
        try {
            const response = await fetch(`${API_BASE_URL}/users/verify-email/${token}`);
            const data = await response.json();

            if (response.ok) {
                setStatus('success');
                setMessage(data.message || 'Email verified successfully!');
                
                // Start countdown for redirect
                let count = 3;
                const timer = setInterval(() => {
                    count -= 1;
                    setCountdown(count);
                    if (count <= 0) {
                        clearInterval(timer);
                        navigate('/login');
                    }
                }, 1000);
            } else {
                setStatus('error');
                setMessage(data.message || 'Invalid or expired verification link.');
            }
        } catch (err) {
            setStatus('error');
            setMessage('Connection error. Please try again later.');
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -bottom-[30%] -right-[10%] w-[70%] h-[70%] rounded-full bg-primary/5 blur-[100px] animate-pulse delay-300" />
                <div className="absolute top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-secondary/10 blur-[100px] animate-pulse" />
            </div>

            <Card className="w-full max-w-md border bg-card shadow-2xl relative text-center">
                <CardHeader>
                    <div className="flex justify-center mb-4">
                        <div className="p-3 bg-primary/10 rounded-full">
                            <ShieldCheck className="w-12 h-12 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">Email Verification</CardTitle>
                    <CardDescription>
                        Complete your registration to secure your account
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {status === 'idle' && (
                        <div className="flex flex-col items-center py-8 space-y-4">
                            <div className="p-3 bg-indigo-100 rounded-full text-indigo-600">
                                <MailCheck className="w-12 h-12" />
                            </div>
                            <p className="text-muted-foreground font-medium">Ready to activate your account?</p>
                            <Button onClick={handleVerify} className="w-full text-lg shadow-lg shadow-primary/20">
                                Verify My Email Address
                            </Button>
                        </div>
                    )}

                    {status === 'loading' && (
                        <div className="flex flex-col items-center py-8 space-y-4">
                            <Loader2 className="w-12 h-12 text-primary animate-spin" />
                            <p className="text-muted-foreground font-medium">Verifying your email address...</p>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center py-8 space-y-4 animate-in fade-in zoom-in duration-500">
                            <div className="p-2 bg-green-100 rounded-full">
                                <CheckCircle2 className="w-12 h-12 text-green-600" />
                            </div>
                            <p className="text-xl font-semibold text-foreground">{message}</p>
                            <div className="space-y-2">
                                <p className="text-muted-foreground">Your account is now fully active.</p>
                                <p className="text-primary font-medium">Redirecting to login in {countdown}s...</p>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center py-8 space-y-4 animate-in fade-in zoom-in duration-500">
                            <div className="p-2 bg-red-100 rounded-full">
                                <XCircle className="w-12 h-12 text-red-600" />
                            </div>
                            <p className="text-xl font-semibold text-foreground">{message}</p>
                            <Button onClick={handleVerify} variant="outline" className="mt-4">
                                Try Again
                            </Button>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex flex-col space-y-4">
                    {status === 'success' && (
                        <Button 
                            className="w-full text-lg shadow-lg group" 
                            onClick={() => navigate('/login')}
                        >
                            Go to Login Now
                            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    )}
                    <div className="text-sm text-muted-foreground">
                        Need help? <Link to="/" className="text-primary hover:underline font-medium">Visit Help Center</Link>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
};

export default VerifyEmail;
