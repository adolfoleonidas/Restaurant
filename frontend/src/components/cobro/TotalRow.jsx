import React from 'react';
import { fmtMoney } from '@/lib/format';

/**
 * Hidden tip field kept for test ids, and the total to charge.
 */
export default function TotalRow({
    chargeAmount, payMode, scopeCaption, tip,
    total,
}) {
    return (
        <>
            {/* Tip data-testid for backwards compat */}
            <input type="hidden" value={tip} data-testid="caja-propina" readOnly />

            {/* Total Row */}
            <div className="total-row">
                <div>
                    <span className="total-label">{payMode === 'all' ? 'Total' : 'Total a cobrar'}</span>
                    {scopeCaption && <span className="total-caption">{scopeCaption}</span>}
                </div>
                <output className="total-amount amount" data-testid="caja-total" aria-live="polite" aria-label="Total a cobrar">{fmtMoney(chargeAmount || total)}</output>
            </div>
        </>
    );
}
