import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Utensils, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/format';

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

    if (user) return <Navigate to="/dashboard" replace />;

    const submit = async (e) => {
        e.preventDefault();
        if (!email || !password) return;
        setLoading(true);
        try {
            await login(email, password);
            const from = location.state?.from?.pathname || '/dashboard';
            navigate(from, { replace: true });
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
            <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
                <img
                    src="https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
                    alt="Restaurante"
                    className="object-cover w-full h-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1F1D1B]/70 via-[#1F1D1B]/30 to-transparent" />
                <div className="absolute bottom-10 left-10 right-10 text-white">
                    <div className="font-display text-4xl font-semibold mb-2">Sistema de Gestión para Restaurantes</div>
                    <div className="text-white/80">Rápido. Confiable. Hecho para tu operación diaria.</div>
                </div>
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-md">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                            <Utensils className="h-6 w-6" />
                        </div>
                        <div>
                            <div className="font-display font-semibold text-xl">Sabor Peruano</div>
                            <div className="text-xs text-muted-foreground">Iniciar sesión</div>
                        </div>
                    </div>

                    <Card>
                        <CardContent className="p-6">
                            <form onSubmit={submit} className="space-y-4">
                                <div>
                                    <Label htmlFor="email">Correo electrónico</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="username"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="correo@resto.com"
                                        data-testid="login-email-input"
                                        className="h-11"
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
                                            className="h-11 pr-10"
                                        />
                                        <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-muted-foreground" data-testid="login-toggle-password">
                                            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </div>
                                <Button type="submit" disabled={loading} className="w-full h-11" data-testid="login-submit-button">
                                    {loading ? 'Ingresando…' : 'Iniciar sesión'}
                                </Button>
                            </form>

                            <div className="mt-6 pt-5 border-t">
                                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Cuentas de demostración</div>
                                <div className="grid grid-cols-2 gap-2">
                                    {DEMO.map((d) => (
                                        <button
                                            key={d.email}
                                            type="button"
                                            onClick={() => fillDemo(d)}
                                            data-testid={`demo-${d.role}-button`}
                                            className="flex flex-col items-start rounded-lg border bg-secondary/40 hover:bg-secondary px-3 py-2 text-left transition-colors"
                                        >
                                            <span className="text-xs font-semibold">{ROLE_LABELS[d.role]}</span>
                                            <span className="text-[11px] text-muted-foreground truncate w-full">{d.email}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
