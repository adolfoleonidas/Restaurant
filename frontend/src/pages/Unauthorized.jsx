import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function Unauthorized() {
    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
            <div className="text-center max-w-md">
                <ShieldAlert className="h-12 w-12 text-primary mx-auto mb-4" />
                <p className="page-kicker mb-2">Acceso</p>
                <h1 className="font-display text-3xl font-semibold mb-2">Sin permisos</h1>
                <p className="text-muted-foreground mb-6">Tu rol no entra a esta sección.</p>
                <Link to="/dashboard" className="text-primary font-medium underline-offset-4 hover:underline">Volver al salón</Link>
            </div>
        </div>
    );
}
