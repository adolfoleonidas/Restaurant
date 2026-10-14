import { LayoutGrid, List } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';

/**
 * El catálogo del día, en tarjetas o en lista.
 *
 * Es presentacional a propósito: recibe el catálogo ya resuelto por el servidor y
 * devuelve intenciones (`onToggleOffered`, `onToggleSoldOut`). Así se puede probar
 * sin base ni red, y la pantalla que lo use no repite esta lógica.
 *
 * Las dos vistas ofrecen **los mismos controles**: en computadora la tabla es más
 * cómoda para editar en bloque; en el celular, una lista compacta. Lo que no se
 * hace es trasladar la tabla al teléfono.
 */
export default function MenuDayView({
    catalog = [],
    mode = 'cards',
    onModeChange,
    onToggleOffered,
    onToggleSoldOut,
    saving = false,
}) {
    const ofrecidos = catalog.filter((p) => p.offered_today).length;

    return (
        <section className="space-y-3" data-testid="menu-day-view">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground" data-testid="menu-day-resumen">
                    {ofrecidos} de {catalog.length} platos se ofrecen hoy
                </p>
                <div className="flex items-center gap-1" role="group" aria-label="Vista">
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'cards' ? 'default' : 'outline'}
                        aria-pressed={mode === 'cards'}
                        onClick={() => onModeChange?.('cards')}
                        data-testid="menu-vista-tarjetas"
                    >
                        <LayoutGrid className="h-4 w-4 mr-1" />Tarjetas
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'list' ? 'default' : 'outline'}
                        aria-pressed={mode === 'list'}
                        onClick={() => onModeChange?.('list')}
                        data-testid="menu-vista-lista"
                    >
                        <List className="h-4 w-4 mr-1" />Lista
                    </Button>
                </div>
            </div>

            {catalog.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="menu-day-vacio">
                    Todavía no hay platos en la carta.
                </p>
            )}

            {mode === 'cards' ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="menu-day-tarjetas">
                    {catalog.map((p) => (
                        <article
                            key={p.product_id}
                            data-testid={`menu-plato-${p.product_id}`}
                            className="rounded-xl border border-border p-3 space-y-2"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <span className="font-medium min-w-0 truncate" title={p.name}>{p.name}</span>
                                <span className="tabular-nums text-sm shrink-0">{fmtMoney(p.today_price)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {p.sold_out ? 'Agotado' : (p.offered_today ? 'Se ofrece hoy' : 'Fuera del menú de hoy')}
                                {p.is_fixed ? ' · carta fija' : ''}
                            </p>
                            <div className="flex gap-1">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={p.offered_today ? 'outline' : 'default'}
                                    disabled={saving || p.is_fixed}
                                    onClick={() => onToggleOffered?.(p.product_id, !p.offered_today)}
                                    data-testid={`menu-ofrecer-${p.product_id}`}
                                >
                                    {p.offered_today ? 'Quitar de hoy' : 'Ofrecer hoy'}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={p.sold_out ? 'default' : 'outline'}
                                    disabled={saving || !p.offered_today}
                                    onClick={() => onToggleSoldOut?.(p.product_id, !p.sold_out)}
                                    data-testid={`menu-agotar-${p.product_id}`}
                                >
                                    {p.sold_out ? 'Volver a habilitar' : 'Agotado'}
                                </Button>
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-border divide-y" data-testid="menu-day-lista">
                    {catalog.map((p) => (
                        <div key={p.product_id} className="flex items-center gap-3 px-3 py-2" data-testid={`menu-fila-${p.product_id}`}>
                            <span className="min-w-0 flex-1 truncate font-medium" title={p.name}>{p.name}</span>
                            <span className="tabular-nums text-sm shrink-0">{fmtMoney(p.today_price)}</span>
                            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                                {p.sold_out ? 'Agotado' : (p.offered_today ? 'Se ofrece' : 'Fuera')}
                            </span>
                            {/* Los mismos dos controles que en la tarjeta: la lista
                                no es solo para mirar, es para editar. */}
                            <Button
                                type="button"
                                size="sm"
                                variant={p.offered_today ? 'outline' : 'default'}
                                disabled={saving || p.is_fixed}
                                onClick={() => onToggleOffered?.(p.product_id, !p.offered_today)}
                                data-testid={`menu-ofrecer-${p.product_id}`}
                            >
                                {p.offered_today ? 'Quitar' : 'Ofrecer'}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={saving || !p.offered_today}
                                onClick={() => onToggleSoldOut?.(p.product_id, !p.sold_out)}
                                data-testid={`menu-agotar-${p.product_id}`}
                            >
                                {p.sold_out ? 'Habilitar' : 'Agotado'}
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
