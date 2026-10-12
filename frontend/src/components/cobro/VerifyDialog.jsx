import React from 'react';
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
                    <label className="confirm-check">
                        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="caja-verificar-check" />
                        <span>{verifyCopy}</span>
                    </label>
                    <p className="confirm-warning">{verifyWarning}</p>
                </div>
                <footer className="dialog-actions">
                    <button className="cancel-button" onClick={() => setShowVerify(false)}>Volver</button>
                    <button className="primary-button" disabled={!verified} onClick={handleConfirm} data-testid="caja-verificar-registrar">Registrar</button>
                </footer>
            </div>
        </div>
    );
}
