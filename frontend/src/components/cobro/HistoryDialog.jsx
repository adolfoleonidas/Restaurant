import React from 'react';
import { fmtMoney } from '@/lib/format';
import { X } from 'lucide-react';
import useSubDialog from '@/hooks/useSubDialog';

/**
 * Account movements summary.
 */
export default function HistoryDialog({
    paid, remaining, setShowHistory,
}) {
    const sub = useSubDialog(() => setShowHistory(false));
    return (
        <div className="cobro-sub-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowHistory(false); }}>
            <div {...sub.props} role="dialog" aria-modal="true" aria-labelledby="history-title" className="cobro-subdialog">
                <header className="dialog-header">
                    <h2 id="history-title">Movimientos de la cuenta</h2>
                    <button className="icon-button" onClick={() => setShowHistory(false)} aria-label="Cerrar">
                        <X style={{ width: 20, height: 20 }} />
                    </button>
                </header>
                <div className="dialog-body">
                    <div className="history-sums" style={{ marginBottom: 12 }}>
                        <div>Pagado<strong className="amount">{fmtMoney(paid)}</strong></div>
                        <div>Restante<strong className="amount">{fmtMoney(remaining)}</strong></div>
                    </div>
                    <p className="help-small">Los movimientos se muestran en el historial de pagos.</p>
                </div>
            </div>
        </div>
    );
}
