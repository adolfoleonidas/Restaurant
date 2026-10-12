import React from 'react';

/**
 * Discount amount and reason for users allowed to discount.
 */
export default function DiscountFields({
    canDiscount, d, discount, discountReason,
    setDiscount, setDiscountReason,
}) {
    return (
        <>
            {/* Discount fields */}
            {canDiscount && (
                <div className="discount-fields">
                    <label>Descuento (S/)</label>
                    <input type="number" min="0" step="0.01" value={discount}
                        onChange={(e) => setDiscount(e.target.value)} data-testid="caja-descuento" />
                    {d > 0 && (
                        <>
                            <label style={{ marginTop: 8 }}>Motivo del descuento</label>
                            <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)}
                                placeholder="Ej. cortesia de la casa" data-testid="caja-descuento-motivo" />
                        </>
                    )}
                </div>
            )}
            {!canDiscount && <div className="discount-fields"><span className="muted" style={{ fontSize: 12 }}>Sin permiso de descuento</span></div>}
        </>
    );
}
