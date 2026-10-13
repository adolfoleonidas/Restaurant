import React from 'react';
import { Input } from '@/components/ui/input';
import { personLabel } from '@/lib/orderDraft';

export default function PersonStrip({ personNameEdit, aliasDraft, setAliasDraft, setPersonNameEdit, saveAlias, setSharedDraft, sharedDraft, order, t, canTake }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" data-testid="mesa-sheet-persona">
            {personNameEdit ? (
                <div className="flex w-full items-center gap-1.5">
                    <Input
                        autoFocus
                        className="h-9 min-w-0 flex-1"
                        placeholder="Nombre"
                        value={aliasDraft}
                        onChange={(e) => setAliasDraft(e.target.value)}
                        onBlur={() => { setPersonNameEdit(false); saveAlias(); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { setPersonNameEdit(false); saveAlias(); }
                            if (e.key === 'Escape') setPersonNameEdit(false);
                        }}
                        data-testid="mesa-sheet-persona-nombre"
                    />
                    <button
                        type="button"
                        onClick={() => setSharedDraft((cur) => !cur)}
                        aria-pressed={sharedDraft}
                        title="Lo que pide la mesa entera"
                        data-testid="mesa-sheet-compartido"
                        className={`flex h-9 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium ${
                            sharedDraft
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:border-primary'
                        }`}
                    >
                        🍽️ Compartido
                    </button>
                </div>
            ) : (
                <>
                    <span className="min-w-0 truncate text-sm">
                        Para <strong>{aliasDraft.trim() || (sharedDraft ? 'Compartido' : order ? personLabel(order, 0) : `Mesa ${t.number}`)}</strong>
                    </span>
                    {canTake && (
                        <span className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setPersonNameEdit(true)}
                                data-testid="mesa-sheet-persona-renombrar"
                                className="flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
                            >
                                ✎ Nombre
                            </button>
                        </span>
                    )}
                </>
            )}
        </div>
    );
}
