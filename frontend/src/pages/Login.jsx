import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/format';
import { homeFor } from '@/lib/home';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';

const DEMO = [
    { email: 'admin@resto.com', password: 'admin123', role: 'admin' },
    { email: 'cajero@resto.com', password: 'cajero123', role: 'cajero' },
    { email: 'mozo@resto.com', password: 'mozo123', role: 'mozo' },
    { email: 'cocina@resto.com', password: 'cocina123', role: 'cocina' },
];

export default function Login() {
    const { user, login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    if (user) return <Navigate to={homeFor(user.role)} replace />;

    const submit = async (e) => {
        e.preventDefault();
        if (!email || !password) return;
        setLoading(true);
        try {
            const logged = await login(email, password);
            const from = location.state?.from?.pathname;
            const fallback = homeFor(logged?.role);
            navigate(from && from !== '/login' ? from : fallback, { replace: true });
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al iniciar sesión');
        } finally {
            setLoading(false);
        }
    };

    const fillDemo = (d) => {
        setEmail(d.email);
        setPassword(d.password);
    };

    return (
        <div className="min-h-screen w-full flex items-stretch bg-background">
            <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden">
                <img
                    src="https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
                    alt=""
                    className="object-cover w-full h-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                <div className="absolute bottom-12 left-12 right-12">
                    <p className="page-kicker text-primary mb-3">Servicio de salón</p>
                    <div className="font-display italic text-5xl font-semibold mb-3 leading-tight">El turno empieza en la carta</div>
                    <div className="text-foreground/75 max-w-md">Mesas, cocina y caja en el mismo ritmo. Sabor Peruano, Barranco.</div>
                </div>
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-md">
                    <div className="flex items-start justify-between mb-10">
                        <Link to="/" className="inline-block">
                            <BrandMark kicker="Personal de salón" />
                        </Link>
                        <ThemeToggle />
                    </div>

                    <form onSubmit={submit} className="space-y-4">
                        <div>
                            <Label htmlFor="email">Correo</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="correo@resto.com"
                                data-testid="login-email-input"
                                className="h-11 rounded-sm"
                            />
                        </div>
                        <div>
                            <Label htmlFor="password">Contraseña</Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={show ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    data-testid="login-password-input"
                                    className="h-11 pr-10 rounded-sm"
                                />
                                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-muted-foreground" data-testid="login-toggle-password">
                                    {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>
                        <Button type="submit" disabled={loading} className="w-full h-12 rounded-sm text-base" data-testid="login-submit-button">
                            {loading ? 'Entrando…' : 'Entrar al salón'}
                        </Button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-border">
                        <div className="page-kicker mb-3">Cuentas demo</div>
                        <div className="grid grid-cols-2 gap-2">
                            {DEMO.map((d) => (
                                <button
                                    key={d.email}
                                    type="button"
                                    onClick={() => fillDemo(d)}
                                    data-testid={`demo-${d.role}-button`}
                                    className="flex flex-col items-start rounded-sm border border-border bg-secondary/40 hover:bg-secondary px-3 py-2.5 text-left transition-colors"
                                >
                                    <span className="text-xs font-semibold">{ROLE_LABELS[d.role]}</span>
                                    <span className="text-[11px] text-muted-foreground truncate w-full">{d.email}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
