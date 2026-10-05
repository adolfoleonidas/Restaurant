import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export default function Unauthorized() {
    // Esta pantalla vive fuera de AppShell y de PublicLayout, así que sin este
    // <main> no hay ningún landmark en la página: axe marcaba 45 nodos entre
    // "landmark-one-main" y contenido fuera de región (36 de los 46 nodos que
    // quedaban en la matriz completa de la ronda 3).
    return (
        <main className="min-h-screen flex items-center justify-center p-6 bg-background">
            <div className="text-center max-w-md">
                <ShieldAlert className="h-12 w-12 text-primary mx-auto mb-4" />
                <p className="page-kicker mb-2">Acceso</p>
                <h1 className="font-display text-3xl font-semibold mb-2">Sin permisos</h1>
                <p className="text-muted-foreground mb-6">Tu rol no entra a esta sección.</p>
                <Link to="/dashboard" className="text-primary font-medium underline-offset-4 hover:underline">Volver al salón</Link>
            </div>
        </main>
    );
}
