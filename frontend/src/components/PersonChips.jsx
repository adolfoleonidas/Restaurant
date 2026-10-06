import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';

/**
 * Personas / subcuentas de una mesa, en una franja compacta.
 *
 * Con pocas personas se ven todas; con muchas la franja se reduce a la persona
 * activa y un contador, y el mozo la expande sólo cuando necesita cambiar.
 * La estructura es siempre la misma: Juan | María | Persona 3 | +
 */
export default function PersonChips({
    people = [],
    activeId = null,
    onSelect,
    onAdd,
    canEdit = false,
    testIdPrefix = 'mesa-sheet',
}) {
    // Con hasta tres personas no hace falta esconder nada; a partir de ahí la
    // franja arranca reducida para no comerse la carta.
    const [override, setOverride] = useState(null);
    const expanded = override === null ? people.length <= 3 : override;
    const active = people.find((p) => p.id === activeId) || people[0] || null;
    const others = people.filter((p) => p.id !== active?.id);

    const chip = (person, { compact = false } = {}) => {
        // Persona 1 todavía no tiene cuenta: se muestra la estructura sin crear
        // una orden vacía, y deja de ser provisional al cargar el primer plato.
        if (person.preview) {
            return (
                <span
                    key={person.id}
                    data-testid={`${testIdPrefix}-cuenta-preview`}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                    {person.label}
                </span>
            );
        }
        const isActive = person.id === active?.id;
        return (
            <button
                key={person.id}
                type="button"
                onClick={() => onSelect?.(person.id)}
                aria-pressed={isActive}
                data-testid={`${testIdPrefix}-cuenta-${person.number ?? person.id}`}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary hover:bg-primary/5'
                }`}
            >
                <span className="max-w-[9rem] truncate">{person.label}</span>
                {person.shared && <span aria-hidden="true">🍽️</span>}
                {!compact && person.number != null && (
                    <span className={`tabular-nums ${isActive ? 'opacity-80' : 'text-muted-foreground'}`}>#{person.number}</span>
                )}
                {person.draftCount > 0 && (
                    <span
                        className={`grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
                            isActive ? 'bg-primary-foreground/20' : 'bg-secondary'
                        }`}
                        data-testid={`${testIdPrefix}-cuenta-pendientes-${person.number ?? person.id}`}
                    >
                        {person.draftCount}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="space-y-1.5" data-testid={`${testIdPrefix}-cuentas`}>
            <div className="flex items-center justify-between gap-2">
                <span className="page-kicker">Personas</span>
                <div className="flex items-center gap-1">
                    {people.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setOverride(!expanded)}
                            aria-expanded={expanded}
                            data-testid={`${testIdPrefix}-personas-toggle`}
                            className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                        >
                            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            {expanded ? 'Contraer personas' : `Expandir personas (${people.length})`}
                        </button>
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => onAdd?.()}
                            aria-label="Agregar persona"
                            data-testid={`${testIdPrefix}-nueva-cuenta`}
                            className="grid h-6 w-6 place-items-center rounded-full border border-border hover:border-primary hover:bg-primary/5"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            <div className="scroll-x flex items-center gap-1.5 pb-1">
                {expanded ? people.map((person) => chip(person)) : active && chip(active)}
                {!expanded && others.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setOverride(true)}
                        data-testid={`${testIdPrefix}-personas-otras`}
                        className="shrink-0 rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary"
                    >
                        +{others.length}
                    </button>
                )}
            </div>
        </div>
    );
}
