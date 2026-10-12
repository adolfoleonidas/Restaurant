import React from 'react';
import { PAYMENT_LABELS } from '@/lib/format';
import { Copy, Maximize2 } from 'lucide-react';
import PaymentProofCapture from '@/components/PaymentProofCapture';

/**
 * Yape / Plin: receiving account, QR and the proof capture.
 */
export default function WalletPanel({
    acct, backendMethod, canSubmitProof, collectionConfig,
    collectionConfigError, copyText, open, proofAlreadySent,
    proofError, proofIntent, proofSending, proofSent,
    selectedProof, setSelectedProof, setShowQr, submitProof,
    walletConfig, walletMethod,
}) {
    return (
        <>
            {/* WALLET PANEL (yape/plin) */}
            {walletMethod && canSubmitProof && (
                <section data-testid="caja-comprobante-pago">
                    {collectionConfigError ? (
                        <p role="status" className="stale-error">No se pudo cargar la configuración. Cierre y vuelve a abrir este diálogo.</p>
                    ) : !collectionConfig ? (
                        <p className="neutral-copy">Cargando opciones de pago…</p>
                    ) : !walletConfig?.enabled ? (
                        <p role="status" className="neutral-copy">Este método no está habilitado para recibir comprobantes.</p>
                    ) : (
                        <div className="account-layout">
                            <div>
                                {/^data:image\/(png|jpeg|webp);base64,/.test(walletConfig.qr || '') ? (
                                    <>
                                        <button className="qr-trigger" aria-haspopup="dialog"
                                            aria-label={`Ampliar código QR de ${PAYMENT_LABELS[backendMethod]}`}
                                            onClick={() => setShowQr(true)}>
                                            <img src={walletConfig.qr} alt={`Código QR de ${PAYMENT_LABELS[backendMethod]}`} data-testid={`caja-${backendMethod}-qr`} />
                                            <span className="qr-expand" aria-hidden="true"><Maximize2 style={{ width: 16, height: 16 }} /></span>
                                        </button>
                                        <p className="qr-caption">Toca para ampliar</p>
                                    </>
                                ) : (
                                    <p className="qr-caption">No hay código QR configurado para este método.</p>
                                )}
                            </div>
                            <dl className="account-data">
                                {walletConfig.number && (
                                    <div className="data-row">
                                        <dt>Número</dt>
                                        <dd className="account-number">{walletConfig.number}</dd>
                                        <button className="copy-button" onClick={() => copyText(walletConfig.number, 'Número')} aria-label="Copiar número">
                                            <Copy style={{ width: 17, height: 17 }} />
                                        </button>
                                    </div>
                                )}
                                {walletConfig.holder && (
                                    <div className="data-row">
                                        <dt>Titular</dt>
                                        <dd>{walletConfig.holder}</dd>
                                        <button className="copy-button" onClick={() => copyText(walletConfig.holder, 'Titular')} aria-label="Copiar titular">
                                            <Copy style={{ width: 17, height: 17 }} />
                                        </button>
                                    </div>
                                )}
                            </dl>
                        </div>
                    )}
                    {walletConfig?.enabled && !proofAlreadySent && (
                        <div className="proof-section">
                            <PaymentProofCapture
                                key={`${acct.id}:${backendMethod}`}
                                proof={selectedProof}
                                onProof={setSelectedProof}
                                disabled={proofSending || Boolean(proofIntent)}
                                active={open && canSubmitProof && walletMethod}
                            />
                            {proofError && <p role="alert" className="stale-error" data-testid="caja-comprobante-error">{proofError}</p>}
                            {proofIntent && !proofSent && <p className="file-hint">Se conservará la imagen y el método para reintentar el mismo envío.</p>}
                            <button type="button" className="primary-button" onClick={submitProof} disabled={!selectedProof || proofSending || proofSent} data-testid="caja-enviar-comprobante">
                                {proofSending ? 'Enviando…' : proofIntent ? 'Reintentar envío del comprobante' : 'Enviar comprobante para revisión'}
                            </button>
                        </div>
                    )}
                </section>
            )}
            {walletMethod && !canSubmitProof && (
                <p className="neutral-copy">Registra el pago solo después de verificar el ingreso. Este usuario no envía comprobantes.</p>
            )}
        </>
    );
}
