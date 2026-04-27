import { API_BASE_URL } from '../../config';
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, KeyRound, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card';

const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isSent, setIsSent] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/users/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (response.ok) {
                setIsSent(true);
            } else {
                setError(data.message || 'Something went wrong');
            }
        } catch (err) {
            setError('Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    if (isSent) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
                <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                    <div className="absolute -bottom-[30%] -right-[10%] w-[70%] h-[70%] rounded-full bg-primary/5 blur-[100px] animate-pulse delay-300" />
                    <div className="absolute top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-secondary/10 blur-[100px] animate-pulse" />
                </div>

                <Card className="w-full max-w-md border bg-card shadow-2xl relative text-center">
                    <CardHeader>
                        <div className="flex justify-center mb-4">
                            <div className="p-3 bg-green-100 rounded-full">
                                <CheckCircle2 className="w-12 h-12 text-green-600" />
                            </div>
                        </div>
                        <CardTitle className="text-3xl font-bold tracking-tight text-primary">Email Sent</CardTitle>
                        <CardDescription>
                            We've sent a password reset link to {email}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            Please check your inbox and click the link to reset your password. If you don't see it, check your spam folder.
                        </p>
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4">
                        <Button className="w-full" onClick={() => navigate('/login')}>
                            Back to Login
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -bottom-[30%] -right-[10%] w-[70%] h-[70%] rounded-full bg-primary/5 blur-[100px] animate-pulse delay-300" />
                <div className="absolute top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-secondary/10 blur-[100px] animate-pulse" />
            </div>

            <Card className="w-full max-w-md border bg-card shadow-2xl relative">
                <div className="absolute top-4 left-4">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/login')} className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft size={16} className="mr-2" />
                        Back
                    </Button>
                </div>
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-2 bg-primary/10 rounded-full">
                            <KeyRound className="w-8 h-8 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">Forgot Password?</CardTitle>
                    <CardDescription>
                        No worries, we'll send you reset instructions.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="p-3 text-sm text-red-500 bg-red-100 rounded-md text-center font-medium animate-in fade-in zoom-in duration-300">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="name@company.com"
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <Button type="submit" disabled={loading} className="w-full text-lg shadow-lg">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Sending Link...
                                </>
                            ) : 'Send Reset Link'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center">
                    <div className="text-sm text-muted-foreground">
                        Wait, I remember my password!{" "}
                        <Link to="/login" className="font-semibold text-primary hover:underline">
                            Go back
                        </Link>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
};

export default ForgotPassword;
