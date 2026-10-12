import React from 'react';
import { CreditCard, X } from 'lucide-react';
import { accountLabel } from '@/lib/cash';
import { countOf } from '@/lib/format';

/**
 * Account title, meta line and the close button.
 */
export default function CobroHeader({
    acct, onOpenChange, paid, result,
}) {
    return (
        <header className="cobro-checkout-header">
            <span className="table-mark" aria-hidden="true"><CreditCard style={{ width: 26, height: 26 }} /></span>
            <div>
                <h1 id="checkout-title">{accountLabel(acct)}</h1>
                <div className="header-meta">
                    {acct.attention_number ? (
                        <>
                            <span>Atención {acct.attention_number}</span>
                            <span className="dot" />
                        </>
                    ) : null}
                    <span>{countOf((acct.items || []).length, 'ítem', 'ítems')}</span>
                    <span className="dot" />
                    <span>{result ? 'Pagada' : paid > 0 ? 'Pago parcial' : 'Cuenta abierta'}</span>
                </div>
            </div>
            <div className="header-right">
                <button className="icon-button" onClick={() => onOpenChange(false)} aria-label="Cerrar cobro">
                    <X style={{ width: 20, height: 20 }} />
                </button>
            </div>
        </header>
    );
}
