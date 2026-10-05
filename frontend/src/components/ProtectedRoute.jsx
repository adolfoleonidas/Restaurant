import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export const ProtectedRoute = ({ children, roles = [] }) => {
    const { user, loading, hasRole } = useAuth();
    const location = useLocation();
    if (loading) {
        return <div className="flex min-h-dvh w-full items-center justify-center text-muted-foreground">Cargando…</div>;
    }
    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }
    if (roles.length > 0 && !hasRole(roles)) {
        return <Navigate to="/unauthorized" replace />;
    }
    return children;
};
