import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/format';
import { homeFor } from '@/lib/home';
import { getPublicRestaurant } from '@/lib/api/public';
import { BrandMark } from '@/components/BrandMark';
import BuildStamp from '@/components/BuildStamp';
import { ThemeToggle } from '@/components/ThemeToggle';
import { apiErrorMessage } from '@/lib/apiError';

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
    const [formError, setFormError] = useState('');
    const [restaurant, setRestaurant] = useState(null);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        let active = true;
        getPublicRestaurant().then(({ data }) => {
            if (active) setRestaurant(data);
        }).catch(() => {});
        return () => { active = false; };
    }, []);

    if (user) return <Navigate to={homeFor(user)} replace />;

    // Demo credentials are a development convenience only: CRA inlines
    // NODE_ENV at build time, so production bundles drop this block.
    const showDemo = process.env.NODE_ENV !== 'production';

    const submit = async (e) => {
        e.preventDefault();
        if (!email || !password) {
            setFormError('Ingresa tu correo y tu contraseña para entrar.');
            return;
        }
        setFormError('');
        setLoading(true);
        try {
            const logged = await login(email, password);
            const from = location.state?.from?.pathname;
            const fallback = homeFor(logged);
            navigate(from && from !== '/login' ? from : fallback, { replace: true });
        } catch (err) {
            const message = apiErrorMessage(err, 'No se pudo iniciar sesión. Revisa tu correo y tu contraseña.');
            setFormError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    const fillDemo = (d) => {
        setEmail(d.email);
        setPassword(d.password);
    };

    // min-h-dvh + overflow-y-auto: en móvil apaisado (844×390) el formulario
    // (login + cuentas demo) no cabe y el recorte dejaba inalcanzable la parte
    // de arriba. El scroll vive aquí y no en la página; `my-auto` mantiene el
    // panel centrado mientras sobre alto y, cuando el contenido desborda, cae a
    // margen 0 (no recorta por arriba como haría `items-center` solo).
    return (
        <main className="min-h-dvh overflow-y-auto w-full flex items-stretch bg-background">
            {/* El panel hero está oculto en móvil (hidden lg:flex): el h1 de la
                página se coloca aquí para que siempre exista un único encabezado
                de nivel 1 visible o accesible. */}
            <h1 className="sr-only">Ingreso de personal</h1>
            <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden">
                <img
                    src="https://images.pexels.com/photos/14590691/pexels-photo-14590691.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1200"
                    alt=""
                    className="object-cover w-full h-full"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                <div className="absolute bottom-12 left-12 right-12">
                    <p className="page-kicker text-primary mb-3">Servicio de salón</p>
                    <p className="font-display text-5xl font-semibold mb-3 leading-tight">El turno empieza en la carta</p>
                    <div className="text-foreground/75 max-w-md">Mesas, cocina y caja en el mismo ritmo. {restaurant?.name || 'Restaurante'}.</div>
                </div>
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-md my-auto">
                    <div className="flex items-start justify-between mb-10">
                        <Link to="/" className="inline-block">
                            <BrandMark name={restaurant?.name || 'Restaurante'} logoUrl={restaurant?.logo_url} kicker="Personal de salón" />
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
                                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-1 top-1 grid h-11 w-11 sm:h-9 sm:w-9 place-items-center text-muted-foreground" data-testid="login-toggle-password">
                                    {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>
                        {formError && (
                            <p role="alert" className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>
                        )}
                        <Button type="submit" disabled={loading} className="w-full h-12 rounded-sm text-base" data-testid="login-submit-button">
                            {loading ? 'Entrando…' : 'Entrar al salón'}
                        </Button>
                    </form>

                    {showDemo && (
                        <div className="mt-8 pt-6 border-t border-border">
                            <div className="page-kicker mb-3">Cuentas demo</div>
                            <div className="grid grid-cols-2 gap-2">
                                {DEMO.map((d) => (
                                    <button
                                        key={d.email}
                                        type="button"
                                        onClick={() => fillDemo(d)}
                                        data-testid={`demo-${d.role}-button`}
                                        className="flex flex-col items-start rounded-sm border border-border bg-secondary/40 hover:bg-secondary px-3 py-2.5 text-left"
                                    >
                                        <span className="text-xs font-semibold">{ROLE_LABELS[d.role]}</span>
                                        <span className="text-xs text-muted-foreground break-all w-full">{d.email}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* La versión que corre este teléfono, sin tener que entrar:
                        es lo primero que se mira cuando "sigue igual". */}
                    <BuildStamp className="mt-6 text-center" prefix="login" />
                </div>
            </div>
        </main>
    );
}
