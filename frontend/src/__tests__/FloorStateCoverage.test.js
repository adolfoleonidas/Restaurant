/**
 * Cobertura de los estados del piso: la invariante que faltaba.
 *
 * La leyenda, los filtros y la tarjeta leen de `FLOOR_STYLE`. Antes eran tres
 * listas escritas a mano y ya habían divergido en las dos direcciones:
 *
 *   * «Entregado» e «Inactiva» se pintaban en una tarjeta pero no existían en la
 *     leyenda;
 *   * «Cuenta pagada», «Reservada» e «Inactiva» no se podían aislar con ningún
 *     filtro, y al elegir cualquier filtro **desaparecían de la pantalla** (no se
 *     atenuaban: `filterUnits` las excluía).
 *
 * Este archivo fija que eso no pueda volver a pasar sin que falle una prueba.
 */
import {
    LEGEND, STATE_FILTERS, STATE_FILTER_FLOORS, countByState, filterUnits,
} from '@/pages/salon/selectors';
import { FLOOR_STYLE } from '@/lib/floorStyle';

const floorKeys = Object.keys(FLOOR_STYLE);

/** Unidad mínima del piso, con la forma que espera `filterUnits`. */
const unit = (key) => ({
    type: 'single',
    floor: { key },
    entry: { table: { id: `t-${key}`, number: 1, name: `Mesa ${key}`, area: 'Salón' } },
});

describe('cobertura de los estados del piso', () => {
    it('la leyenda es exactamente la lista de estados, sin recortes ni repeticiones', () => {
        expect(LEGEND).toEqual(floorKeys);
        expect(new Set(LEGEND).size).toBe(LEGEND.length);
    });

    it('cada estado se puede aislar con un filtro', () => {
        const aislables = new Set(Object.values(STATE_FILTER_FLOORS).flat());
        const sinFiltro = floorKeys.filter((k) => !aislables.has(k));
        expect(sinFiltro).toEqual([]);
    });

    it('ningún filtro apunta a un estado que no existe', () => {
        const desconocidos = [...new Set(Object.values(STATE_FILTER_FLOORS).flat())]
            .filter((k) => !floorKeys.includes(k));
        expect(desconocidos).toEqual([]);
    });

    it('todo chip de estado tiene su mapa, y ninguno se queda sin etiqueta', () => {
        STATE_FILTERS.forEach((f) => {
            expect(typeof f.label).toBe('string');
            expect(f.label.length).toBeGreaterThan(0);
            if (f.key === 'todas') return;
            expect(Array.isArray(STATE_FILTER_FLOORS[f.key])).toBe(true);
            expect(STATE_FILTER_FLOORS[f.key].length).toBeGreaterThan(0);
        });
    });

    it('el conteo del chip coincide con lo que aparece al pulsarlo', () => {
        // El fallo que motivó esta prueba: un chip podía decir 1 y al pulsarlo
        // no aparecer nada, porque contaba con un mapa y filtraba con otro.
        const units = floorKeys.map(unit);
        const counts = countByState(units);
        STATE_FILTERS.forEach((f) => {
            const visibles = filterUnits(units, { areaFilter: 'todas', stateFilter: f.key, search: '', sortMode: 'numero' });
            expect([f.key, visibles.length]).toEqual([f.key, counts[f.key]]);
        });
    });

    it('«Todas» no esconde ningún estado', () => {
        const units = floorKeys.map(unit);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'todas', search: '', sortMode: 'numero' }))
            .toHaveLength(floorKeys.length);
    });

    it('una mesa anulada ya no se cuenta como ocupada', () => {
        // `atencion` es la cuenta anulada con la visita abierta: se contaba y se
        // filtraba dentro de «Ocupadas».
        const units = [unit('atencion'), unit('sentados')];
        const counts = countByState(units);
        expect(counts.anulada).toBe(1);
        expect(counts.activas).toBe(1);
        expect(filterUnits(units, { areaFilter: 'todas', stateFilter: 'activas', search: '', sortMode: 'numero' })
            .map((u) => u.floor.key)).toEqual(['sentados']);
    });
});
