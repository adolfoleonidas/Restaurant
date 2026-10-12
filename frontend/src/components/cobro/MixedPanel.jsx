import React from 'react';
import { fmtMoney } from '@/lib/format';
import { X } from 'lucide-react';
import { METHOD_MAP } from '@/lib/paymentMethods';
import { METHODS } from '@/components/cobro/constants';

/**
 * Mixed payment lines and their allocation bar.
 */
export default function MixedPanel({
    addSplit, canAddSplit, chargeAmount, md,
    method, removeSplit, splits, splitsTotal,
    updateSplit,
}) {
    return (
        <>
            {/* MIXED PANEL */}
            {method === 'mixed' && (
                <div>
                    <p className="neutral-copy">Combina varios metodos. El ultimo metodo completa el total.</p>
                    {splits.map((s, idx) => {
                        const isLast = idx === splits.length - 1;
                        const usedMethods = splits.map(l => l.method);
                        return (
                            <div key={idx} className="mixed-line">
                                <select value={s.method} onChange={(e) => updateSplit(idx, { method: e.target.value })}
                                    data-testid={`caja-metodo-${METHOD_MAP[s.method] || s.method}`}
                                    aria-label={`Metodo ${idx + 1}`}>
                                    {METHODS.filter(m => m.id !== 'mixed').map(m => (
                                        <option key={m.id} value={m.id} disabled={m.id !== s.method && usedMethods.includes(m.id)}>{m.name}</option>
                                    ))}
                                </select>
                                {isLast ? (
                                    <output className="mixed-auto amount" aria-label={`Resto a cobrar con el método ${idx + 1}`}>{fmtMoney(Math.max(0, md.rest))}</output>
                                ) : (
                                    <div className="currency-input">
                                        <span>S/</span>
                                        <input type="text" inputMode="decimal" value={s.amount} placeholder="0.00" maxLength={9}
                                            onChange={(e) => updateSplit(idx, { amount: e.target.value })}
                                            data-testid={`caja-split-${idx}-amount`} aria-label={`Importe metodo ${idx + 1}`} />
                                    </div>
                                )}
                                <button className="icon-button mixed-remove" onClick={() => removeSplit(idx)}
                                    disabled={splits.length <= 2} aria-label="Quitar metodo">
                                    <X style={{ width: 17, height: 17 }} />
                                </button>
                            </div>
                        );
                    })}
                    <div className="mixed-bar" aria-hidden="true">
                        <i style={{ width: `${chargeAmount ? Math.min(100, Math.round(splitsTotal / chargeAmount * 100)) : 0}%` }} />
                    </div>
                    <p className="mixed-note">Asignado {fmtMoney(Math.min(splitsTotal, chargeAmount))} de {fmtMoney(chargeAmount)}</p>
                    {md.error && <p role="status" className="field-error">{md.error}</p>}
                    <button className="secondary-button mixed-add" type="button"
                        disabled={!canAddSplit}
                        onClick={addSplit}>
                        + Agregar otro metodo
                    </button>
                </div>
            )}
        </>
    );
}
