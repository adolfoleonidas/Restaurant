import React, { useEffect } from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { CartProvider } from '@/contexts/CartContext';
import { LiveOrderProvider } from '@/contexts/LiveOrderContext';
import { TableProvider } from '@/contexts/TableContext';
import { AssistantProvider } from '@/contexts/AssistantContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { routeRoles } from '@/lib/permissions';
import { AppShell } from '@/components/AppShell';
import ErrorBoundary from '@/components/ErrorBoundary';
import { PublicLayout } from '@/components/PublicLayout';
// Las pantallas que ve el cliente al escanear el QR se cargan de entrada: son
// la puerta de la app y pesan poco. Las del POS se cargan al entrar (ver
// AppShell), para que quien solo quiere ver la carta no descargue el salón, la
// caja ni las gráficas de reportes.
import Login from '@/pages/Login';
import Unauthorized from '@/pages/Unauthorized';
import Landing from '@/pages/Landing';
import CategoriaPage from '@/pages/CategoriaPage';
import Checkout from '@/pages/Checkout';
import PedidoTracking from '@/pages/PedidoTracking';

const Dashboard = React.lazy(() => import('@/pages/Dashboard'));
const Salon = React.lazy(() => import('@/pages/Salon'));
const Local = React.lazy(() => import('@/pages/Local'));
const Pedidos = React.lazy(() => import('@/pages/Pedidos'));
const PedidoNuevo = React.lazy(() => import('@/pages/PedidoNuevo'));
const PedidoDetalle = React.lazy(() => import('@/pages/PedidoDetalle'));
const Cocina = React.lazy(() => import('@/pages/Cocina'));
const Caja = React.lazy(() => import('@/pages/Caja'));
const Comprobantes = React.lazy(() => import('@/pages/Comprobantes'));
const Productos = React.lazy(() => import('@/pages/Productos'));
const Combos = React.lazy(() => import('@/pages/Combos'));
const Categorias = React.lazy(() => import('@/pages/Categorias'));
const Usuarios = React.lazy(() => import('@/pages/Usuarios'));
const Reportes = React.lazy(() => import('@/pages/Reportes'));
const Configuracion = React.lazy(() => import('@/pages/Configuracion'));
const Pagos = React.lazy(() => import('@/pages/Pagos'));
const Disponibilidad = React.lazy(() => import('@/pages/Disponibilidad'));
const GestionarMenu = React.lazy(() => import('@/pages/menu/GestionarMenu'));

// The role guard of every route comes from lib/permissions, the same module the
// navigation reads.
const guard = (path, element) => <ProtectedRoute roles={routeRoles(path)}>{element}</ProtectedRoute>;

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [pathname]);
    return null;
}

// El título de la pestaña no cambia por ruta: todas las pestañas se llaman igual
// y quien navega con lector de pantalla pierde la confirmación del cambio de
// vista. La base sale del <title> de index.html, así que el nombre del negocio
// se ajusta en un solo lugar.
const BASE_TITLE = document.title;
const ROUTE_TITLES = [
    ['/', 'Carta pública'],
    ['/menu', 'Carta pública'],
    ['/checkout', 'Confirmar pedido'],
    ['/pedido', 'Seguimiento'],
    ['/login', 'Ingreso'],
    ['/unauthorized', 'Sin permisos'],
    ['/dashboard', 'Hoy'],
    ['/salon', 'Salón'],
    ['/local', 'Local'],
    ['/pedidos', 'Pedidos'],
    ['/cocina', 'Pase de cocina'],
    ['/caja', 'Caja'],
    ['/comprobantes', 'Comprobantes'],
    ['/reportes', 'Reportes'],
    ['/disponibilidad', 'Disponibilidad'],
    ['/productos', 'Carta'],
    ['/combos', 'Combos'],
    ['/categorias', 'Categorías'],
    ['/usuarios', 'Equipo'],
    ['/pagos', 'Datos de cobro'],
    ['/configuracion', 'Configuración'],
];

function RouteTitle() {
    const { pathname } = useLocation();
    const hit = ROUTE_TITLES.find(([p]) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
    const section = hit ? hit[1] : null;
    useEffect(() => {
        document.title = section ? `${section} · ${BASE_TITLE}` : BASE_TITLE;
    }, [section]);
    return null;
}

// ThemeProvider vive fuera del router, así que la ruta activa se le reporta
// desde aquí: así la cocina puede quedar en modo oscuro (y salir de él al
// navegar al resto de la app).
function ThemeRouteSync() {
    const { pathname } = useLocation();
    const { setActivePath } = useTheme();
    useEffect(() => {
        setActivePath(pathname);
    }, [pathname, setActivePath]);
    return null;
}

// Un error de una pantalla no debe dejar la app en blanco: el límite se rearma
// al cambiar de ruta, así navegar fuera de la pantalla rota recupera.
function RouteErrorBoundary({ children }) {
    const { pathname } = useLocation();
    return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

function App() {
    return (
        <div className="App">
            <AuthProvider>
                    <CartProvider>
                        <LiveOrderProvider>
                            <AssistantProvider>
                            <BrowserRouter>
                                <TableProvider>
                                <ScrollToTop />
                                <RouteTitle />
                                <ThemeRouteSync />
                                <RouteErrorBoundary>
                                <Routes>
                                {/* PUBLIC ROUTES */}
                                <Route element={<PublicLayout />}>
                                    <Route index element={<Landing />} />
                                    <Route path="/menu" element={<Landing />} />
                                    <Route path="/menu/categoria/:id" element={<CategoriaPage />} />
                                    <Route path="/checkout" element={<Checkout />} />
                                    <Route path="/pedido/:code" element={<PedidoTracking />} />
                                </Route>

                                {/* AUTH ROUTES */}
                                <Route path="/login" element={<Login />} />
                                <Route path="/unauthorized" element={<Unauthorized />} />

                                {/* ADMIN ROUTES */}
                                <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                                    <Route path="/dashboard" element={<Dashboard />} />
                                    <Route path="/salon" element={guard('/salon', <Salon />)} />
                                    <Route path="/servicio" element={<Navigate to="/salon" replace />} />
                                    <Route path="/local" element={guard('/local', <Local />)} />
                                    <Route path="/mesas" element={<Navigate to="/local" replace />} />
                                    <Route path="/pedidos" element={guard('/pedidos', <Pedidos />)} />
                                    <Route path="/pedidos/nuevo" element={guard('/pedidos/nuevo', <PedidoNuevo />)} />
                                    <Route path="/pedidos/:id" element={guard('/pedidos/:id', <PedidoDetalle />)} />
                                    <Route path="/cocina" element={guard('/cocina', <Cocina />)} />
                                    <Route path="/caja" element={guard('/caja', <Caja />)} />
                                    <Route path="/comprobantes" element={guard('/comprobantes', <Comprobantes />)} />
                                    <Route path="/reportes" element={guard('/reportes', <Reportes />)} />
                                    <Route path="/disponibilidad" element={guard('/disponibilidad', <Disponibilidad />)} />
                                    <Route path="/productos" element={guard('/productos', <Productos />)} />
                                    <Route path="/menu" element={guard('/menu', <GestionarMenu />)} />
                                    <Route path="/combos" element={guard('/combos', <Combos />)} />
                                    <Route path="/categorias" element={guard('/categorias', <Categorias />)} />
                                    <Route path="/usuarios" element={guard('/usuarios', <Usuarios />)} />
                                    <Route path="/pagos" element={guard('/pagos', <Pagos />)} />
                                    <Route path="/configuracion" element={guard('/configuracion', <Configuracion />)} />
                                </Route>

                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                            </RouteErrorBoundary>
                            </TableProvider>
                        </BrowserRouter>
                            </AssistantProvider>
                    </LiveOrderProvider>
                </CartProvider>
            </AuthProvider>
        </div>
    );
}

export default App;
