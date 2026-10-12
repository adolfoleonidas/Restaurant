import React from 'react';
import { fmtMoney } from '@/lib/format';

/**
 * Paid and remaining sums of the account.
 */
export default function PaymentHistory({
    paid, remaining, setShowHistory,
}) {
    return (
        <>
            {/* Payment History */}
            <div className="payment-history">
                {paid > 0 && (
                    <div className="history-title">
                        <strong>Movimientos de la cuenta</strong>
                        <button onClick={() => setShowHistory(true)}>Ver detalle</button>
                    </div>
                )}
                <div className="history-sums">
                    <div>Pagado<strong className="amount">{fmtMoney(paid)}</strong></div>
                    <div>Saldo de la cuenta<strong className="amount">{fmtMoney(remaining)}</strong></div>
                </div>
            </div>
        </>
    );
}
