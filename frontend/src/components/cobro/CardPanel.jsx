import React from 'react';

/**
 * Card terminal reference.
 */
export default function CardPanel({
    cardRef, method, setCardRef,
}) {
    return (
        <>
            {/* CARD PANEL */}
            {method === 'card' && (
                <div>
                    <p className="neutral-copy">Registra el cobro aprobado en tu POS. No ingreses el numero de la tarjeta ni su codigo de seguridad.</p>
                    <div className="terminal-fields">
                        <label>Referencia de operacion <span className="optional">· Opcional</span></label>
                        <input className="text-input" maxLength={60} placeholder="Ej. codigo de operacion" value={cardRef} onChange={(e) => setCardRef(e.target.value)} />
                    </div>
                </div>
            )}
        </>
    );
}
