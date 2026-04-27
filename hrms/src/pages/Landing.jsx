import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, Globe, Shield, Zap, LogIn, UserCircle, Briefcase } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';

const Landing = () => {
    const navigate = useNavigate();
    const { adminUser, employeeUser } = useAuth();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const isLoggedIn = adminUser || employeeUser;

    return (
        <div className="min-h-screen bg-background selection:bg-primary/10 selection:text-primary">
            <div className="max-w-app mx-auto min-h-screen bg-background text-foreground flex flex-col font-sans border-x border-border/40 shadow-sm relative">
                {/* Navbar */}
                <nav className="border-b border-border/40 backdrop-blur-md sticky top-0 z-50 bg-background/80">
                    <div className="w-full px-6 h-16 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-bold text-primary-foreground">
                                H
                            </div>
                            <span className="font-bold text-xl tracking-tight">HRMS Pro</span>
                        </div>

                        {/* Desktop Nav */}
                        <div className="hidden md:flex gap-3">
                            {isLoggedIn ? (
                                <Button
                                    onClick={() => navigate(adminUser ? '/admin/dashboard' : '/employee/dashboard')}
                                    className="shadow-lg shadow-primary/10"
                                >
                                    Go to Dashboard
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        variant="ghost"
                                        className="gap-2"
                                        onClick={() => navigate('/login', { state: { role: 'employee' } })}
                                    >
                                        <UserCircle size={18} />
                                        Employee Login
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="gap-2 border-primary/20 hover:border-primary/40 hover:bg-primary/5"
                                        onClick={() => navigate('/login', { state: { role: 'admin' } })}
                                    >
                                        <Briefcase size={18} />
                                        Admin Portal
                                    </Button>
                                </>
                            )}
                        </div>

                        {/* Mobile Menu Toggle */}
                        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                            {isMobileMenuOpen ? <div /> : <div className="space-y-1.5">
                                <span className="block h-0.5 w-6 bg-foreground"></span>
                                <span className="block h-0.5 w-6 bg-foreground"></span>
                                <span className="block h-0.5 w-6 bg-foreground"></span>
                            </div>}
                        </Button>
                    </div>

                    {/* Mobile Menu Overlay */}
                    {isMobileMenuOpen && (
                        <div className="md:hidden absolute top-16 left-0 w-full bg-background border-b border-border/40 p-4 shadow-xl animate-in slide-in-from-top-5">
                            <div className="flex flex-col gap-3">
                                {isLoggedIn ? (
                                    <Button
                                        onClick={() => navigate(adminUser ? '/admin/dashboard' : '/employee/dashboard')}
                                        className="w-full justify-start"
                                    >
                                        Go to Dashboard
                                    </Button>
                                ) : (
                                    <>
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start gap-2"
                                            onClick={() => navigate('/login', { state: { role: 'employee' } })}
                                        >
                                            <UserCircle size={18} />
                                            Employee Login
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="w-full justify-start gap-2"
                                            onClick={() => navigate('/login', { state: { role: 'admin' } })}
                                        >
                                            <Briefcase size={18} />
                                            Admin Portal
                                        </Button>
                                    </>
                                )}
                                <Button className="w-full" onClick={() => navigate('/register')}>Get Started</Button>
                            </div>
                        </div>
                    )}
                </nav>

                {/* Hero Section */}
                <main className="flex-1">
                    <section className="relative overflow-hidden pt-20 pb-32">
                        {/* Background Gradients */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 pointer-events-none">
                            <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
                            <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-emerald-500/5 blur-[100px] rounded-full animate-pulse delay-700" />
                        </div>

                        <div className="w-full px-6 text-center">
                            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-primary/10 text-primary mb-6">
                                ✨ Reimagining Workplace Management
                            </div>
                            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 text-foreground">
                                The Future of <br className="hidden md:block" />
                                <span className="text-primary">Human Resources</span>
                            </h1>
                            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
                                Manage attendance, payroll, and projects with an interface that feels like magic.
                                Designed for modern teams who value aesthetics and efficiency.
                            </p>

                            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                                <Button size="lg" className="h-12 px-8 text-lg rounded-full shadow-xl shadow-primary/20" onClick={() => navigate('/login')}>
                                    Start Your Journey <ArrowRight className="ml-2 h-5 w-5" />
                                </Button>
                                <Button variant="outline" size="lg" className="h-12 px-8 text-lg rounded-full bg-background/50 backdrop-blur">
                                    View Demo
                                </Button>
                            </div>

                        </div>
                    </section>

                    {/* Features / About Section */}
                    <section className="py-24 bg-muted/30 border-t border-border/40">
                        <div className="w-full px-6">
                            <div className="text-center mb-16">
                                <h2 className="text-3xl font-bold tracking-tight mb-4">Why Choose HRMS Pro?</h2>
                                <p className="text-muted-foreground max-w-2xl mx-auto">
                                    We've stripped away the complexity and left only what matters—powerful tools wrapped in a stunning design.
                                </p>
                            </div>

                            <div className="grid md:grid-cols-3 gap-8">
                                {[
                                    { icon: Zap, title: "Lightning Fast", desc: "Optimized for speed. No more waiting for clunky enterprise software to load." },
                                    { icon: Shield, title: "Enterprise Security", desc: "Bank-grade encryption keeps your employee data safe and compliant." },
                                    { icon: Globe, title: "Global Scale", desc: "Manage teams across time zones with smart attendance tracking." }
                                ].map((feature, idx) => (
                                    <div key={idx} className="p-8 rounded-2xl bg-card border border-border/50 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-6">
                                            <feature.icon size={24} />
                                        </div>
                                        <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                                        <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* CTA Section */}
                    <section className="py-24 relative overflow-hidden">
                        <div className="absolute inset-0 bg-primary/5 -z-10" />
                        <div className="w-full px-6 text-center">
                            <h2 className="text-4xl font-bold mb-6">Ready to transform your workflow?</h2>
                            <Button size="lg" onClick={() => navigate('/register')} className="h-12 px-8 text-lg rounded-full">
                                Get Started Today
                            </Button>
                        </div>
                    </section>
                </main>

                {/* Footer */}
                <footer className="border-t border-border/40 py-12 bg-card/30">
                    <div className="w-full px-6 grid md:grid-cols-4 gap-8">
                        <div className="col-span-2">
                            <div className="flex items-center gap-2 mb-4">
                                <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center font-bold text-primary-foreground text-xs">H</div>
                                <span className="font-bold text-lg">HRMS Pro</span>
                            </div>
                            <p className="text-muted-foreground max-w-xs">
                                The modern standard for human resource management. Built for speed, designed for people.
                            </p>
                        </div>
                        <div>
                            <h4 className="font-bold mb-4">Product</h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li><a href="#" className="hover:text-foreground">Features</a></li>
                                <li><a href="#" className="hover:text-foreground">Pricing</a></li>
                                <li><a href="#" className="hover:text-foreground">Showcase</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold mb-4">Company</h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li><a href="#" className="hover:text-foreground">About</a></li>
                                <li><a href="#" className="hover:text-foreground">Careers</a></li>
                                <li><a href="#" className="hover:text-foreground">Contact</a></li>
                            </ul>
                        </div>
                    </div>
                    <div className="w-full px-6 mt-12 pt-8 border-t border-border/40 text-center text-sm text-muted-foreground">
                        © 2026 HRMS Pro Inc. All rights reserved.
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default Landing;
