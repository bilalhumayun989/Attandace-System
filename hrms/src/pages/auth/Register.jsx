import { API_BASE_URL } from '../../config';
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, Mail, Building2, User, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card';

const Register = () => {
    const [formData, setFormData] = useState({
        employeeId: '',
        companyName: '',
        adminName: '',
        email: '',
        password: ''

    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isRegistered, setIsRegistered] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);
    const [resending, setResending] = useState(false);
    const [resendStatus, setResendStatus] = useState('');

    const navigate = useNavigate();

    useEffect(() => {
        let interval;
        if (resendTimer > 0) {
            interval = setInterval(() => {
                setResendTimer((prev) => prev - 1);
            }, 1000);
        } else {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [resendTimer]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleResendEmail = async () => {
        if (resendTimer > 0) return;
        setResending(true);
        setResendStatus('');

        try {
            const response = await fetch(`${API_BASE_URL}/users/resend-verification`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: formData.email }),
            });

            const data = await response.json();

            if (response.ok) {
                setResendStatus('Verification email resent successfully!');
                setResendTimer(30);
            } else {
                setResendStatus(data.message || 'Failed to resend email');
            }
        } catch (err) {
            setResendStatus('Error connecting to server');
        } finally {
            setResending(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/users/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    employeeId: formData.employeeId,
                    name: formData.adminName,
                    email: formData.email,
                    password: formData.password,
                    companyName: formData.companyName
                }),

            });

            const data = await response.json();

            if (response.ok) {
                setIsRegistered(true);
            } else {
                setError(data.message || 'Registration failed');
            }
        } catch (err) {
            setError('Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    if (isRegistered) {
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
                        <CardTitle className="text-3xl font-bold tracking-tight text-primary">Check Your Email</CardTitle>
                        <CardDescription>
                            We've sent a verification link to {formData.email}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground">
                            Please click the link in the email to activate your account. If you don't see it, check your spam folder.
                        </p>
                        {resendStatus && (
                            <p className={`text-sm font-medium ${resendStatus.includes('successfully') ? 'text-green-600' : 'text-red-500'}`}>
                                {resendStatus}
                            </p>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4">
                        <Button 
                            variant="outline" 
                            className="w-full" 
                            onClick={handleResendEmail} 
                            disabled={resending || resendTimer > 0}
                        >
                            {resending ? 'Resending...' : resendTimer > 0 ? `Resend Email (${resendTimer}s)` : 'Resend Email'}
                        </Button>
                        <Button className="w-full" onClick={() => navigate('/login')}>
                            Go to Login
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
                    <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft size={16} className="mr-2" />
                        Back
                    </Button>
                </div>
                <CardHeader className="text-center">
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">Create Account</CardTitle>
                    <CardDescription>
                        Set up your company workspace
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleRegister} className="space-y-4">
                        {error && (
                            <div className="p-3 text-sm text-red-500 bg-red-100 rounded-md text-center font-medium animate-in fade-in zoom-in duration-300">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Employee ID (for Login)</label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    name="employeeId"
                                    value={formData.employeeId}
                                    onChange={handleInputChange}
                                    placeholder="ADMIN-001"
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Company Name</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    name="companyName"
                                    value={formData.companyName}
                                    onChange={handleInputChange}
                                    placeholder="Acme Inc."
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>


                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Admin Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    name="adminName"
                                    value={formData.adminName}
                                    onChange={handleInputChange}
                                    placeholder="John Doe"
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Work Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    placeholder="admin@company.com"
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <Button type="submit" disabled={loading} className="w-full text-lg shadow-lg shadow-primary/20">
                            {loading ? 'Creating Account...' : 'Get Started'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center">
                    <div className="text-sm text-muted-foreground">
                        Already have an account?{" "}
                        <Link to="/login" className="font-semibold text-primary hover:underline">
                            Sign in
                        </Link>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
};

export default Register;
