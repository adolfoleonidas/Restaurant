import React from 'react';
import { CheckCircle2, Info } from 'lucide-react';

/**
 * Footer note and the cancel / register buttons.
 */
export default function CobroFooter({
    canRegister, footerNote, handleRegister, loading,
    netError, onOpenChange, proofRefreshPending, registerLabel,
    result,
}) {
    const blocked = !result && !canRegister;
    // A blocked register button always says why, even when no specific note applies.
    const reason = footerNote || (blocked ? 'Completa los datos del cobro para continuar' : '');
    return (
        <footer className="cobro-checkout-footer">
            <span className="footer-caption">
                <Info style={{ width: 14, height: 14 }} />
                <span id="cobro-footer-note" className={reason ? 'footer-note why' : 'footer-note'}>{reason || 'Caja POS · Verifica el pago antes de registrarlo'}</span>
            </span>
            <div className="footer-actions">
                <button className="cancel-button" onClick={() => onOpenChange(false)}>Cancelar</button>
                <button className="primary-button" onClick={handleRegister}
                    disabled={proofRefreshPending || loading || blocked}
                    aria-describedby="cobro-footer-note"
                    data-testid="caja-cobrar-submit-button">
                    <CheckCircle2 style={{ width: 19, height: 19 }} />
                    <span>{loading ? 'Registrando...' : (netError ? 'Reintentar el mismo cobro' : registerLabel)}</span>
                </button>
            </div>
        </footer>
    );
}
