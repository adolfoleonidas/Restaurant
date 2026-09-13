import React, { useEffect } from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { LiveOrderProvider } from '@/contexts/LiveOrderContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/AppShell';
import { PublicLayout } from '@/components/PublicLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Mesas from '@/pages/Mesas';
import Pedidos from '@/pages/Pedidos';
import PedidoNuevo from '@/pages/PedidoNuevo';
import PedidoDetalle from '@/pages/PedidoDetalle';
import Cocina from '@/pages/Cocina';
import Caja from '@/pages/Caja';
import Productos from '@/pages/Productos';
import Combos from '@/pages/Combos';
import Categorias from '@/pages/Categorias';
import Usuarios from '@/pages/Usuarios';
import Reportes from '@/pages/Reportes';
import Configuracion from '@/pages/Configuracion';
import Pagos from '@/pages/Pagos';
import Disponibilidad from '@/pages/Disponibilidad';
import Servicio from '@/pages/Servicio';
import Unauthorized from '@/pages/Unauthorized';
import Landing from '@/pages/Landing';
import CategoriaPage from '@/pages/CategoriaPage';
import Checkout from '@/pages/Checkout';
import PedidoTracking from '@/pages/PedidoTracking';

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, [pathname]);
    return null;
}

function App() {
    return (
        <div className="App">
            <AuthProvider>
                <CartProvider>
                    <LiveOrderProvider>
                        <BrowserRouter>
                            <ScrollToTop />
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
                                    <Route path="/servicio" element={<Servicio />} />
                                    <Route path="/mesas" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><Mesas /></ProtectedRoute>} />
                                    <Route path="/pedidos" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><Pedidos /></ProtectedRoute>} />
                                    <Route path="/pedidos/nuevo" element={<ProtectedRoute roles={['admin', 'mozo']}><PedidoNuevo /></ProtectedRoute>} />
                                    <Route path="/pedidos/:id" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><PedidoDetalle /></ProtectedRoute>} />
                                    <Route path="/cocina" element={<ProtectedRoute roles={['admin', 'cocina', 'mozo']}><Cocina /></ProtectedRoute>} />
                                    <Route path="/caja" element={<ProtectedRoute roles={['admin', 'cajero']}><Caja /></ProtectedRoute>} />
                                    <Route path="/reportes" element={<ProtectedRoute roles={['admin']}><Reportes /></ProtectedRoute>} />
                                    <Route path="/disponibilidad" element={<ProtectedRoute roles={['admin', 'cocina']}><Disponibilidad /></ProtectedRoute>} />
                                    <Route path="/productos" element={<ProtectedRoute roles={['admin']}><Productos /></ProtectedRoute>} />
                                    <Route path="/combos" element={<ProtectedRoute roles={['admin']}><Combos /></ProtectedRoute>} />
                                    <Route path="/categorias" element={<ProtectedRoute roles={['admin']}><Categorias /></ProtectedRoute>} />
                                    <Route path="/usuarios" element={<ProtectedRoute roles={['admin']}><Usuarios /></ProtectedRoute>} />
                                    <Route path="/pagos" element={<ProtectedRoute roles={['admin']}><Pagos /></ProtectedRoute>} />
                                    <Route path="/configuracion" element={<ProtectedRoute roles={['admin']}><Configuracion /></ProtectedRoute>} />
                                </Route>

                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>
                        </BrowserRouter>
                    </LiveOrderProvider>
                </CartProvider>
            </AuthProvider>
        </div>
    );
}

export default App;
