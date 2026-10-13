import React from 'react';
import { isChunkLoadFailure, takeTheNewBuild } from '@/lib/chunkRecovery';

/**
 * Captura errores de render para que un fallo de una pantalla no deje la app en
 * blanco. Sin esto, cualquier excepción desmonta todo el árbol de React y el
 * usuario ve una pantalla vacía sin ninguna pista.
 *
 * Muestra el mensaje del error, permite reintentar y ofrece volver al salón.
 *
 * Si lo que falló fue un trozo de la app que no se pudo descargar (el síntoma de
 * un teléfono con una build vieja guardada por el service worker), reintentar no
 * puede funcionar: el archivo ya no está en el servidor. Ahí se ofrece traer la
 * build nueva, que es lo único que arregla (ver `lib/chunkRecovery`).
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null, updating: false };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Queda en la consola del navegador para poder diagnosticar.
        console.error('[ErrorBoundary]', error, info?.componentStack);
    }

    handleRetry = () => {
        this.setState({ error: null });
        this.props.onRetry?.();
    };

    handleUpdate = () => {
        this.setState({ updating: true });
        void takeTheNewBuild();
    };

    render() {
        const { error, updating } = this.state;
        if (!error) return this.props.children;
        const stalePiece = isChunkLoadFailure(error);
        return (
            <div className="grid min-h-[60vh] place-items-center p-6" data-testid="app-error-boundary">
                <div className="w-full max-w-lg space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                    <h2 className="font-display text-xl font-semibold">
                        {stalePiece ? 'Falta una parte de la app' : 'Algo salió mal en esta pantalla'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {stalePiece
                            ? 'Este teléfono quedó con una versión vieja guardada y sus archivos ya no están en el servidor. Trae la versión nueva para seguir.'
                            : 'Hubo un error al dibujar la pantalla. Reintenta; si vuelve a pasar, pasanos este detalle.'}
                    </p>
                    <pre
                        className="whitespace-pre-wrap break-words rounded-lg border border-border bg-background/60 p-3 text-xs"
                        data-testid="app-error-message"
                    >
                        {String(error?.message || error)}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={this.handleRetry}
                            data-testid="app-error-retry"
                            className="h-10 rounded-lg border border-border px-4 font-medium"
                        >
                            Reintentar
                        </button>
                        <button
                            type="button"
                            onClick={this.handleUpdate}
                            disabled={updating}
                            data-testid="app-error-update"
                            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60"
                        >
                            {updating ? 'Trayendo la versión nueva…' : 'Actualizar la app'}
                        </button>
                        <a
                            href="/salon"
                            onClick={this.handleRetry}
                            className="inline-flex h-10 items-center rounded-lg border border-border px-4 font-medium"
                        >
                            Ir al Salón
                        </a>
                    </div>
                </div>
            </div>
        );
    }
}
