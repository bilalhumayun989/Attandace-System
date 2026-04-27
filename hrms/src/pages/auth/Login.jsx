import { API_BASE_URL } from '../../config';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Lock, Mail, Building2, User, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card';
import { useAuth } from '../../context/AuthContext';
import { useState, useEffect } from 'react';

const Login = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [id, setId] = useState('');

    const [password, setPassword] = useState('');
    const [role, setRole] = useState('employee'); // 'employee' | 'admin'
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const { login } = useAuth();

    useEffect(() => {
        if (location.state?.role) {
            setRole(location.state.role);
        }
    }, [location.state]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_BASE_URL}/users/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id, password }),

            });

            const data = await response.json();

            if (response.ok) {
                login(data);
                if (data.role === 'Admin') {
                    navigate('/admin/dashboard');
                } else {
                    navigate('/employee/dashboard');
                }
            } else {
                setError(data.message || 'Login failed');
            }
        } catch (err) {
            setError('Error connecting to server');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute -top-[30%] -left-[10%] w-[70%] h-[70%] rounded-full bg-primary/5 blur-[100px] animate-pulse" />
                <div className="absolute top-[20%] -right-[10%] w-[50%] h-[50%] rounded-full bg-accent/5 blur-[100px] animate-pulse delay-700" />
            </div>

            <Card className="w-full max-w-md border bg-card shadow-2xl relative">
                <div className="absolute top-4 left-4">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="text-muted-foreground hover:text-foreground">
                        <ArrowLeft size={16} className="mr-2" />
                        Back
                    </Button>
                </div>
                <CardHeader className="text-center">
                    <CardTitle className="text-3xl font-bold tracking-tight text-primary">Welcome Back</CardTitle>
                    <CardDescription>
                        Enter your credentials to access the workspace
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {/* Role Toggle */}
                    <div className="grid grid-cols-2 gap-2 p-1 mb-6 bg-muted/50 rounded-lg">
                        <button
                            onClick={() => setRole('employee')}
                            className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${role === 'employee'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <User size={16} />
                            Employee
                        </button>
                        <button
                            onClick={() => setRole('admin')}
                            className={`flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${role === 'admin'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Building2 size={16} />
                            Admin
                        </button>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        {error && (
                            <div className="p-3 text-sm text-red-500 bg-red-100 rounded-md text-center font-medium animate-in fade-in zoom-in duration-300">
                                {error}
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Employee ID or Email</label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="text"
                                    placeholder="EMP-001 or name@company.com"
                                    className="pl-10"

                                    value={id}
                                    onChange={(e) => setId(e.target.value)}
                                    required
                                />
                            </div>
                        </div>


                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium leading-none">Password</label>
                                <Link to="/forgot-password" size="sm" className="text-sm font-medium text-primary hover:underline">
                                    Forgot password?
                                </Link>
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    className="pl-10 pr-10"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
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

                        <Button type="submit" disabled={loading} className="w-full text-lg shadow-lg shadow-primary/20">
                            {loading ? 'Signing In...' : 'Sign In'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex flex-col gap-4 text-center">
                    <div className="text-sm text-muted-foreground">
                        Don't have a company account?{" "}
                        <Link to="/register" className="font-semibold text-primary hover:underline">
                            Register Agency
                        </Link>
                    </div>
                </CardFooter>
            </Card>
        </div>
    );
};

export default Login;
