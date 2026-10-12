import React from 'react';
import { fmtMoney } from '@/lib/format';
import { ChevronDown } from 'lucide-react';

/**
 * Account detail: the line items table (with item picking) and its toggle.
 */
export default function LineItems({
    acct, detailOpen, payMode, picked,
    setDetailOpen, setPicked,
}) {
    return (
        <>
            {/* Order heading */}
            <div className="order-heading">
                <h2 className="section-heading">Detalle de la cuenta</h2>
                <span className="item-count">{(acct.items || []).length} items</span>
                <button className="detail-toggle" aria-expanded={detailOpen} onClick={() => setDetailOpen(!detailOpen)}>
                    <span>{detailOpen ? 'Ocultar' : `Ver ${(acct.items || []).length} items`}</span>
                    <ChevronDown style={{ width: 16, height: 16 }} />
                </button>
            </div>

            {/* Line items */}
            <div className="line-items-region" hidden={!detailOpen}>
                <table className="line-items">
                    <thead>
                        <tr>
                            <th>{payMode === 'items' ? 'Sel.' : 'Cant.'}</th>
                            <th>Descripcion</th>
                            <th>Importe</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(acct.items || []).map((it) => {
                            const unpaid = Math.max(0, (it.quantity || 0) - (it.paid_qty || 0));
                            const paidQty = it.paid_qty || 0;
                            const isSelected = payMode === 'items' && (picked[it.id] || 0) > 0;
                            return (
                                <tr key={it.id}
                                    className={`${payMode === 'items' && unpaid > 0 ? 'item-selectable' : ''} ${isSelected ? 'item-selected' : ''} ${unpaid === 0 ? 'item-settled' : ''}`}
                                    onClick={() => {
                                        if (payMode === 'items' && unpaid > 0) {
                                            setPicked({ ...picked, [it.id]: picked[it.id] ? 0 : unpaid });
                                        }
                                    }}
                                >
                                    <td>
                                        {payMode === 'items' && unpaid > 0 ? (
                                            <input type="checkbox" className="item-check" checked={isSelected}
                                                onChange={(e) => { e.stopPropagation(); setPicked({ ...picked, [it.id]: e.target.checked ? unpaid : 0 }); }}
                                                aria-label={`${isSelected ? 'Quitar' : 'Cobrar'}: ${it.product_name}`}
                                            />
                                        ) : `${it.quantity}x`}
                                    </td>
                                    <td>
                                        <span className="item-name">{it.product_name}</span>
                                        {paidQty > 0 && <span className="item-paid-label">{paidQty} pagados</span>}
                                    </td>
                                    <td className="amount">{fmtMoney(it.subtotal)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {payMode === 'items' && <p className="selection-hint">Selecciona los productos que vas a cobrar.</p>}
        </>
    );
}
