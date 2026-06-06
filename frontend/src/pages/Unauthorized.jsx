import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function Unauthorized() {
    return (
        <div className="min-h-screen flex items-center justify-center p-6">
            <div className="text-center max-w-md">
                <ShieldAlert className="h-12 w-12 text-accent mx-auto mb-4" />
                <h1 className="font-display text-2xl font-semibold mb-2">Sin permisos</h1>
                <p className="text-muted-foreground mb-6">No tienes acceso a esta sección con tu rol actual.</p>
                <Link to="/dashboard" className="text-primary font-medium underline-offset-4 hover:underline">Volver al inicio</Link>
            </div>
        </div>
    );
}
