import React from 'react';
import '@/App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
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
import Categorias from '@/pages/Categorias';
import Usuarios from '@/pages/Usuarios';
import Reportes from '@/pages/Reportes';
import Configuracion from '@/pages/Configuracion';
import Pagos from '@/pages/Pagos';
import Unauthorized from '@/pages/Unauthorized';
import Landing from '@/pages/Landing';
import Checkout from '@/pages/Checkout';
import PedidoTracking from '@/pages/PedidoTracking';

function App() {
    return (
        <div className="App">
            <AuthProvider>
                <CartProvider>
                    <BrowserRouter>
                        <Routes>
                            {/* PUBLIC ROUTES */}
                            <Route element={<PublicLayout />}>
                                <Route index element={<Landing />} />
                                <Route path="/menu" element={<Landing />} />
                                <Route path="/checkout" element={<Checkout />} />
                                <Route path="/pedido/:code" element={<PedidoTracking />} />
                            </Route>

                            {/* AUTH ROUTES */}
                            <Route path="/login" element={<Login />} />
                            <Route path="/unauthorized" element={<Unauthorized />} />

                            {/* ADMIN ROUTES */}
                            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
                                <Route path="/dashboard" element={<Dashboard />} />
                                <Route path="/mesas" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><Mesas /></ProtectedRoute>} />
                                <Route path="/pedidos" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><Pedidos /></ProtectedRoute>} />
                                <Route path="/pedidos/nuevo" element={<ProtectedRoute roles={['admin', 'mozo']}><PedidoNuevo /></ProtectedRoute>} />
                                <Route path="/pedidos/:id" element={<ProtectedRoute roles={['admin', 'mozo', 'cajero']}><PedidoDetalle /></ProtectedRoute>} />
                                <Route path="/cocina" element={<ProtectedRoute roles={['admin', 'cocina', 'mozo']}><Cocina /></ProtectedRoute>} />
                                <Route path="/caja" element={<ProtectedRoute roles={['admin', 'cajero']}><Caja /></ProtectedRoute>} />
                                <Route path="/reportes" element={<ProtectedRoute roles={['admin', 'cajero']}><Reportes /></ProtectedRoute>} />
                                <Route path="/productos" element={<ProtectedRoute roles={['admin']}><Productos /></ProtectedRoute>} />
                                <Route path="/categorias" element={<ProtectedRoute roles={['admin']}><Categorias /></ProtectedRoute>} />
                                <Route path="/usuarios" element={<ProtectedRoute roles={['admin']}><Usuarios /></ProtectedRoute>} />
                                <Route path="/pagos" element={<ProtectedRoute roles={['admin']}><Pagos /></ProtectedRoute>} />
                                <Route path="/configuracion" element={<ProtectedRoute roles={['admin']}><Configuracion /></ProtectedRoute>} />
                            </Route>

                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </BrowserRouter>
                </CartProvider>
            </AuthProvider>
        </div>
    );
}

export default App;
