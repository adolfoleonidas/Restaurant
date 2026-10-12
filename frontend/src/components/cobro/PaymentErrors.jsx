import React from 'react';
import { fmtMoney } from '@/lib/format';

/**
 * Network error and stale account messages.
 */
export default function PaymentErrors({
    netError, stale,
}) {
    return (
        <>
            {/* Errors */}
            {netError && (
                <div className="net-error" data-testid="caja-red-error">
                    Se cortó la conexión. El pago puede haberse registrado. No inicies otro cobro: reintenta esta misma operación.
                </div>
            )}
            {stale && (
                <div className="stale-error" data-testid="caja-cuenta-cambio">
                    {stale.message || 'La cuenta cambio mientras la revisabas.'}
                    {stale.new_total != null && <div style={{ marginTop: 4 }}>Nuevo total: {fmtMoney(stale.new_total)}</div>}
                </div>
            )}
        </>
    );
}
