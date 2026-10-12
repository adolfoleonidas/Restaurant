import React, { useRef, useState } from 'react';
import { fmtMoney } from '@/lib/format';
import { X } from 'lucide-react';
import { METHODS } from '@/components/cobro/constants';

/**
 * Confirmation dialog before registering a payment.
 */
export default function VerifyDialog({
    chargeAmount, handleConfirm, method, setShowVerify,
    setVerified, verified, verifyContext, verifyCopy,
    verifyWarning,
}) {
    const checkRef = useRef(null);
    const [attempted, setAttempted] = useState(false);
    const missing = attempted && !verified;

    // The button stays clickable: without the tick it explains itself instead of staying silent.
    const handleRegisterClick = () => {
        if (!verified) {
            setAttempted(true);
            checkRef.current?.focus();
            return;
        }
        handleConfirm();
    };

    return (
        <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowVerify(false); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="verify-title" className="cobro-subdialog">
                <header className="dialog-header">
                    <h2 id="verify-title">Verificar antes de registrar</h2>
                    <button className="icon-button" onClick={() => setShowVerify(false)} aria-label="Cerrar">
                        <X style={{ width: 20, height: 20 }} />
                    </button>
                </header>
                <div className="dialog-body">
                    <div className="confirm-summary">
                        <div>
                            <div className="muted">Importe de este cobro</div>
                            <div className="confirm-method">{METHODS.find(m => m.id === method)?.name}</div>
                        </div>
                        <strong className="amount">{fmtMoney(chargeAmount)}</strong>
                    </div>
                    {verifyContext && <p className="verify-context">{verifyContext}</p>}
                    <label className={missing ? 'confirm-check needs-attention' : 'confirm-check'}>
                        <input ref={checkRef} type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)}
                            aria-invalid={missing ? 'true' : undefined}
                            aria-describedby={missing ? 'verify-check-hint' : undefined}
                            data-testid="caja-verificar-check" />
                        <span>{verifyCopy}</span>
                    </label>
                    {missing && <p id="verify-check-hint" className="confirm-hint" role="alert">Marca la casilla para continuar</p>}
                    <p className="confirm-warning">{verifyWarning}</p>
                </div>
                <footer className="dialog-actions">
                    <button className="cancel-button" onClick={() => setShowVerify(false)}>Volver</button>
                    <button className="primary-button" onClick={handleRegisterClick} data-testid="caja-verificar-registrar">Registrar</button>
                </footer>
            </div>
        </div>
    );
}
