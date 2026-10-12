import React from 'react';
import { fmtMoney } from '@/lib/format';
import { Lock } from 'lucide-react';
import { equalShare, round2 } from '@/lib/cash';
import { TIP_CHIPS } from '@/components/cobro/constants';

/**
 * Subtotal, discount line and the tip box.
 */
export default function ChargeSummary({
    baseTotal, canDiscount, d, handleTipChip,
    itemsAmount, partsN, payMode, setTip,
    setTipPct, tip, tipInvalid, tipPct,
    tipVal,
}) {
    return (
        <>
            {/* Charge Summary */}
            <div className="charge-summary">
                <div className="summary-line">
                    <span>{payMode === 'equal' ? 'Subtotal de esta parte' : 'Subtotal'}</span>
                    <span className="amount">{fmtMoney(payMode === 'items' ? itemsAmount : payMode === 'equal' ? equalShare(baseTotal, partsN) : baseTotal)}</span>
                </div>
                <div className="summary-line">
                    <span className="discount-label" title={canDiscount ? '' : 'No editable'}>
                        Descuento{!canDiscount && <Lock style={{ width: 12, height: 12 }} />}
                    </span>
                    <span className="amount">- {fmtMoney(d)}</span>
                </div>

                {/* Tip */}
                <div className="tip-box">
                    <div className="summary-line tip-line">
                        <label>{payMode === 'all' ? 'Propina' : 'Propina proporcional'}</label>
                        {payMode === 'all' ? (
                            <div className="currency-input">
                                <span>S/</span>
                                <input type="text" inputMode="decimal" value={tip} placeholder="Otro monto" maxLength={9}
                                    onChange={(e) => { setTip(e.target.value); setTipPct(0); }}
                                    aria-label="Otro monto de propina" />
                            </div>
                        ) : (
                            <span className="amount">{fmtMoney(tipVal)}</span>
                        )}
                    </div>
                    {payMode === 'all' && (
                        <div className="tip-chips" role="group" aria-label="Propina por porcentaje">
                            {TIP_CHIPS.map((pct) => (
                                <button key={pct} className="tip-chip" aria-pressed={pct === 0 ? (!tip && tipPct === 0) : (tipPct === pct)}
                                    onClick={() => handleTipChip(pct)}>
                                    {pct ? `${pct}%` : 'Sin propina'}
                                    {pct > 0 && <small>{fmtMoney(round2(baseTotal * pct / 100))}</small>}
                                </button>
                            ))}
                        </div>
                    )}
                    {tipInvalid && <p role="status" className="field-error">Usa un importe positivo con máximo 2 decimales.</p>}
                </div>
            </div>
        </>
    );
}
