import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Menú "⋯ Más": el lugar de las acciones ocasionales de una pantalla.
 *
 * Existe para que la barra de una pantalla no acumule botones: lo que se hace en
 * cada ronda queda visible y lo excepcional vive acá. Ver la jerarquía de
 * acciones en `docs/spec/especificacion-ui-ux-pantallas-v0.1.md`.
 *
 * Se implementa a mano en vez de usar el menú de Radix por dos razones concretas:
 * esta pieza vive dentro de una hoja (diálogo modal) y el portal de Radix pelea
 * con el foco del diálogo —al elegir una opción se cierra la hoja—, y además
 * Radix mide con `ResizeObserver`, que jsdom no trae, así que abrirlo en una
 * prueba la deja colgada. Acá alcanza con un botón, una lista con roles y cerrar
 * con Escape o tocando afuera.
 */
export default function MoreActions({ testId, actions, label = 'Más opciones' }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onMouseDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [open]);

    // Teclado: Escape cierra el menú, no la hoja que lo contiene. El diálogo modal
    // de Radix escucha Escape en `document` durante la captura y gana por orden de
    // registro, así que hay que escuchar un nivel más arriba: `window` es el primer
    // nodo de la fase de captura.
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const items = Array.from(listRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
                if (items.length === 0) return;
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                const index = items.indexOf(document.activeElement);
                items[(index + delta + items.length) % items.length]?.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    }, [open]);

    if (actions.length === 0) return null;

    return (
        <div className="relative" ref={containerRef}>
            <Button
                variant="ghost"
                className="w-full h-11 rounded-xl bg-secondary/60 px-3 text-sm font-medium text-muted-foreground hover:bg-secondary"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                data-testid={testId}
            >
                <span className="flex w-full items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <MoreHorizontal className="h-4 w-4 shrink-0" />
                        <span className="truncate">{label}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
            </Button>
            {open && (
                <div
                    ref={listRef}
                    role="menu"
                    aria-label={label}
                    data-testid={`${testId}-menu`}
                    className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-md border bg-popover p-1 shadow-lg"
                >
                    {actions.map((action) => (
                        action.group ? (
                            <p key={action.group} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                                {action.group}
                            </p>
                        ) : (
                            <button
                                key={action.key}
                                type="button"
                                role="menuitem"
                                disabled={action.disabled}
                                data-testid={action.testId}
                                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                                onClick={() => { setOpen(false); action.onSelect(); }}
                            >
                                {action.icon ? <action.icon className="h-4 w-4 shrink-0" /> : null}
                                <span className="truncate">{action.label}</span>
                            </button>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}
