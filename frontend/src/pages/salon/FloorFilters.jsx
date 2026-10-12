import React from 'react';
import { LEGEND, STATE_FILTERS } from '@/pages/salon/selectors';
import { FLOOR_STYLE } from '@/lib/floorStyle';

/**
 * State filter chips, the zone segmented control and the floor legend.
 */
export default function FloorFilters({
    areaFilter, areaLabel, areas, setAreaFilter,
    setStateFilter, stateCounts, stateFilter,
}) {
    return (
        <>
            {/* State filter */}
            <div className="scroll-x flex gap-2 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" data-testid="salon-filtros">
                {STATE_FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => setStateFilter(f.key)}
                        data-testid={`salon-filtro-${f.key}`}
                        className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${stateFilter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-secondary border-border'}`}
                    >
                        {f.label} <span className="ml-1.5 text-xs tabular-nums">{stateCounts[f.key]}</span>
                    </button>
                ))}
            </div>

            {/* Zones as a segmented control: same behaviour and same testids as
                the old chip row, but the active zone reads as a pressed segment
                (aria-pressed) inside a labelled group, instead of a run of
                independent pills. Still a horizontal scroller at 360 px. */}
            <div
                role="group"
                aria-label="Zona de la mesa"
                data-testid="salon-zonas"
                className="scroll-x sm:overflow-visible sm:pb-0"
            >
                <div className="inline-flex w-max gap-1 rounded-sm border border-border bg-secondary/60 p-1 sm:w-auto sm:flex-wrap">
                    {areas.map((a) => (
                        <button
                            key={a}
                            type="button"
                            onClick={() => setAreaFilter(a)}
                            aria-pressed={areaFilter === a}
                            data-testid={`mesas-area-${a}`}
                            className={`shrink-0 min-h-touch rounded-sm px-3 text-sm font-medium transition-colors sm:min-h-9 ${areaFilter === a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {areaLabel(a)}
                        </button>
                    ))}
                </div>
            </div>

            {/* La leyenda va en su propia fila: dentro del carril con scroll
                quedaba a la derecha, fuera de la vista en móvil. Es una clave,
                no un control, así que se compacta al máximo: con padding de
                píldora ocupaba 94 px en 360 px (tres filas) y empujaba la
                primera mesa hasta el píxel 525 de 640. */}
            <div className="flex w-full flex-wrap gap-1 items-center lg:justify-end" data-testid="salon-legend">
                {LEGEND.map((k) => {
                    const s = FLOOR_STYLE[k];
                    return (
                        <span key={k} className="text-xs px-1.5 py-0.5 rounded-full border flex items-center gap-1 shrink-0" style={{ background: s.bg, borderColor: s.border, color: s.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
                            {s.label}
                        </span>
                    );
                })}
            </div>
        </>
    );
}
