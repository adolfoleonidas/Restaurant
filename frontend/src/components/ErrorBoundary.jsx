import React from 'react';

/**
 * Captura errores de render para que un fallo de una pantalla no deje la app en
 * blanco. Sin esto, cualquier excepción desmonta todo el árbol de React y el
 * usuario ve una pantalla vacía sin ninguna pista.
 *
 * Muestra el mensaje del error, permite reintentar y ofrece volver al salón.
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
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

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div className="grid min-h-[60vh] place-items-center p-6" data-testid="app-error-boundary">
                <div className="w-full max-w-lg space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                    <h2 className="font-display text-xl font-semibold">Algo salió mal en esta pantalla</h2>
                    <p className="text-sm text-muted-foreground">
                        Hubo un error al dibujar la pantalla. Reintenta; si vuelve a pasar, pasanos este detalle.
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
                        <a
                            href="/salon"
                            onClick={this.handleRetry}
                            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground"
                        >
                            Ir al Salón
                        </a>
                    </div>
                </div>
            </div>
        );
    }
}
