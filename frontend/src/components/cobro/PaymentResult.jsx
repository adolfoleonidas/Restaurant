import React from 'react';
import { fmtMoney } from '@/lib/format';
import { CheckCircle2, Printer } from 'lucide-react';

/**
 * Success message, change to hand back and the receipt actions.
 */
export default function PaymentResult({
    doPrint, onChargeRest, onNextAccount, result,
}) {
    return (
        <>
            {/* Success Inline */}
            {result && (
                <>
                    <div className="success-inline" data-testid="caja-pago-ok" role="status">
                        <CheckCircle2 style={{ width: 18, height: 18 }} />
                        <span>{result.fully_paid ? 'Cuenta pagada.' : `Pago parcial registrado. Restante: ${fmtMoney(result.remaining)}`}</span>
                    </div>
                    {result.change_amount > 0 && (
                        <div className="change-row" style={{ marginTop: 8 }}>
                            <span>Entregar vuelto</span>
                            <strong className="amount">{fmtMoney(result.change_amount)}</strong>
                        </div>
                    )}
                    <div className="receipt-actions">
                        <button className="secondary-button" onClick={doPrint} data-testid="caja-imprimir">
                            <Printer style={{ width: 18, height: 18 }} /> Imprimir recibo
                        </button>
                        {result.fully_paid ? (
                            <button className="secondary-button" onClick={onNextAccount} data-testid="caja-siguiente">
                                Siguiente cuenta
                            </button>
                        ) : (
                            <button className="secondary-button" onClick={onChargeRest} data-testid="caja-cobrar-resto">
                                Cobrar el resto
                            </button>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
