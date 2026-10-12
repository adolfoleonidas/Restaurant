import React from 'react';
import { X } from 'lucide-react';

/**
 * Help dialog with the steps to register a wallet payment.
 */
export default function HelpDialog({
    setShowHelp,
}) {
    return (
        <div className="cobro-sub-overlay cobro-sheet" onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="cobro-subdialog">
                <header className="dialog-header">
                    <h2 id="help-title">Cómo registrar este cobro</h2>
                    <button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Cerrar ayuda">
                        <X style={{ width: 20, height: 20 }} />
                    </button>
                </header>
                <div className="dialog-body">
                    <ol className="help-steps">
                        <li><strong>Muestra los datos de pago</strong>El cliente puede escanear el QR desde su teléfono o usar el número. Toca el QR para ampliarlo.</li>
                        <li><strong>Adjunta un respaldo, si lo necesitas</strong>Puedes subir una imagen o tomar una foto. Enviarla a revisión no cambia el saldo de la cuenta.</li>
                        <li><strong>Verifica y registra</strong>Comprueba el movimiento en la cuenta receptora. Luego registra el pago. Una captura por sí sola no lo valida.</li>
                    </ol>
                </div>
            </div>
        </div>
    );
}
