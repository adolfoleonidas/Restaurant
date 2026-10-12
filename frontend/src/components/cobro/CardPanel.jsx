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
                    <p className="neutral-copy">Registra el cobro aprobado en tu POS. No ingreses el número de la tarjeta ni su código de seguridad.</p>
                    <div className="terminal-fields">
                        <label htmlFor="caja-tarjeta-referencia">Referencia de operación <span className="optional">· Opcional</span></label>
                        <input id="caja-tarjeta-referencia" className="text-input" maxLength={60} placeholder="Ej. código de operación" value={cardRef} onChange={(e) => setCardRef(e.target.value)} />
                    </div>
                </div>
            )}
        </>
    );
}
