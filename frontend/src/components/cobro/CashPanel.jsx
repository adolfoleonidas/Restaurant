import React from 'react';
import { fmtMoney } from '@/lib/format';
import { KEYPAD_KEYS } from '@/components/cobro/constants';

/**
 * Cash received, keypad, presets and change.
 */
export default function CashPanel({
    cashError, change, chargeAmount, coarsePointer,
    handleKeypadPress, handlePreset, method, quickCash, received,
    setReceived,
}) {
    return (
        <>
            {/* CASH PANEL */}
            {method === 'cash' && (
                <div className="cash-fields">
                    <label htmlFor="caja-recibido">Efectivo recibido</label>
                    <div className="currency-input">
                        <span>S/</span>
                        <input id="caja-recibido" type="text" inputMode={coarsePointer ? 'none' : 'decimal'} value={received} placeholder={chargeAmount.toFixed(2)}
                            onChange={(e) => setReceived(e.target.value)}
                            data-testid="caja-recibido-input" aria-label="Efectivo recibido" />
                    </div>
                    {coarsePointer && (
                        <div className="keypad" role="group" aria-label="Teclado numérico de efectivo">
                            {KEYPAD_KEYS.map((k) => (
                                <button key={k} type="button" onClick={() => handleKeypadPress(k)}
                                    aria-label={k === '⌫' ? 'Borrar' : k === '.' ? 'Punto decimal' : k}>
                                    {k}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="preset-cash">
                        <button onClick={() => handlePreset('exact')} data-testid="caja-preset-exacto">Exacto</button>
                        {quickCash.map((value, index) => (
                            <button key={`${value}-${index}`} onClick={() => handlePreset(value)} data-testid={`caja-preset-${index}`}>
                                {fmtMoney(value)}
                            </button>
                        ))}
                    </div>
                    <div className="change-row">
                        <span>Vuelto</span>
                        <strong className="amount" data-testid="caja-vuelto">{fmtMoney(change)}</strong>
                    </div>
                    {cashError && <p role="status" className="field-error">{cashError}</p>}
                </div>
            )}
        </>
    );
}
