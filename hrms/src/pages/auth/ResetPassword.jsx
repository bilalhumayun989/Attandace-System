import { API_BASE_URL } from '../../config';
import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Lock, ArrowLeft, Loader2, ShieldCheck, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card';

const ResetPassword = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [isReset, setIsReset] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (password !== confirmPassword) {
            return setError('Passwords do not match');
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/users/reset-password/${token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            const data = await response.json();

            if (response.ok) {
                setIsReset(true);
            } else {
                setError(data.message || 'Reset failed. Token might be invalid or expired.');
            }
        } catch (err) {
            setError('Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    if (isReset) {
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
                        <CardTitle className="text-3xl font-bold tracking-tight text-primary">Password Reset!</CardTitle>
                        <CardDescription>
                            Your password has been updated successfully.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">
                            You can now use your new password to sign in to your account.
                        </p>
                    </CardContent>
                    <CardFooter className="flex flex-col space-y-4">
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
                <CardHeader className="text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-2 bg-primary/10 rounded-full">
                            <ShieldCheck className="w-8 h-8 text-primary" />
                        </div>
                    </div>
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">Reset Password</CardTitle>
                    <CardDescription>
                        Set a new, secure password for your account.
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
                            <label className="text-sm font-medium leading-none">New Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="pl-10 pr-10"
                                    required
                                    minLength={6}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Confirm New Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="pl-10 pr-10"
                                    required
                                />
                            </div>
                        </div>

                        <Button type="submit" disabled={loading} className="w-full text-lg shadow-lg">
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Updating Password...
                                </>
                            ) : 'Update Password'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex justify-center">
                    <div className="text-sm text-muted-foreground text-center">
                        Back to <Link to="/login" className="font-semibold text-primary hover:underline">Login</Link>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
};

export default ResetPassword;
