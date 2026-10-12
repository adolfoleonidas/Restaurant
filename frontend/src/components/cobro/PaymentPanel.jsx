import React from 'react';
import { fmtMoney } from '@/lib/format';
import { Info, HelpCircle } from 'lucide-react';
import MethodRail from '@/components/cobro/MethodRail';
import WalletPanel from '@/components/cobro/WalletPanel';
import CashPanel from '@/components/cobro/CashPanel';
import CardPanel from '@/components/cobro/CardPanel';
import TransferPanel from '@/components/cobro/TransferPanel';
import MixedPanel from '@/components/cobro/MixedPanel';
import ProofStatus from '@/components/cobro/ProofStatus';
import PaymentHistory from '@/components/cobro/PaymentHistory';
import PaymentResult from '@/components/cobro/PaymentResult';
import PaymentErrors from '@/components/cobro/PaymentErrors';

/**
 * Right panel: amount hero, methods, method details and payment status.
 */
export default function PaymentPanel({
    acct, addSplit, backendMethod, canAddSplit,
    canSubmitProof, cardRef, cashError, change,
    chargeAmount, coarsePointer, collectionConfig, collectionConfigError,
    copyText, doPrint, handleKeypadPress, handlePreset,
    md, method, netError, onChargeRest,
    onNextAccount, open, paid, payMode,
    proofAlreadySent, proofError, proofIntent, proofRefreshError,
    proofRefreshPending, proofSending, proofSent, received,
    remaining, removeSplit, result, retryOrderRefresh,
    scopeCaption, selectMethod, selectedProof, setCardRef,
    setReceived, setSelectedProof, setShowHelp, setShowHistory,
    setShowQr, splits, splitsTotal, stale,
    submitProof, updateSplit, walletConfig, walletMethod,
}) {
    return (
        <section className="payment-panel" aria-label="Datos y registro del pago">
            {/* Pay Hero */}
            <div className="pay-hero">
                <div>
                    <small>{result ? 'Total pagado' : payMode === 'equal' ? 'Parte por cobrar' : 'Por cobrar'}</small>
                    <output className="amount" aria-live="polite">{fmtMoney(chargeAmount)}</output>
                </div>
                {scopeCaption && <span className="cap">{scopeCaption}</span>}
            </div>

            <MethodRail
                method={method}
                proofIntent={proofIntent}
                proofSent={proofSent}
                selectMethod={selectMethod}
            />

            {/* Payment Details */}
            <div className="payment-card" data-tone={walletMethod ? 'wallet' : 'neutral'}>
                <h3 className="card-heading">
                    {method === 'cash' ? 'Recibir efectivo' : walletMethod ? 'Cuenta receptora' : method === 'card' ? 'Pago en terminal' : method === 'transfer' ? 'Datos de transferencia' : 'Distribuir el pago'}
                </h3>
                {walletMethod && (
                    <button className="help-button" onClick={() => setShowHelp(true)} aria-label="Ayuda" title="Ayuda">
                        <HelpCircle style={{ width: 19, height: 19 }} />
                    </button>
                )}

                <WalletPanel
                    acct={acct}
                    backendMethod={backendMethod}
                    canSubmitProof={canSubmitProof}
                    collectionConfig={collectionConfig}
                    collectionConfigError={collectionConfigError}
                    copyText={copyText}
                    open={open}
                    proofAlreadySent={proofAlreadySent}
                    proofError={proofError}
                    proofIntent={proofIntent}
                    proofSending={proofSending}
                    proofSent={proofSent}
                    selectedProof={selectedProof}
                    setSelectedProof={setSelectedProof}
                    setShowQr={setShowQr}
                    submitProof={submitProof}
                    walletConfig={walletConfig}
                    walletMethod={walletMethod}
                />

                <CashPanel
                    cashError={cashError}
                    change={change}
                    chargeAmount={chargeAmount}
                    coarsePointer={coarsePointer}
                    handleKeypadPress={handleKeypadPress}
                    handlePreset={handlePreset}
                    method={method}
                    received={received}
                    setReceived={setReceived}
                />

                <CardPanel
                    cardRef={cardRef}
                    method={method}
                    setCardRef={setCardRef}
                />

                <TransferPanel
                    method={method}
                />

                <MixedPanel
                    addSplit={addSplit}
                    canAddSplit={canAddSplit}
                    chargeAmount={chargeAmount}
                    md={md}
                    method={method}
                    removeSplit={removeSplit}
                    splits={splits}
                    splitsTotal={splitsTotal}
                    updateSplit={updateSplit}
                />
            </div>

            <ProofStatus
                acct={acct}
                proofIntent={proofIntent}
                proofRefreshError={proofRefreshError}
                proofRefreshPending={proofRefreshPending}
                proofSent={proofSent}
                retryOrderRefresh={retryOrderRefresh}
            />

            {/* Payment Note */}
            {method !== 'cash' && (
                <p className="payment-note">
                    <Info style={{ width: 14, height: 14 }} />
                    <span>Una imagen <strong>no confirma</strong> el ingreso del dinero.</span>
                </p>
            )}

            <PaymentHistory
                paid={paid}
                remaining={remaining}
                setShowHistory={setShowHistory}
            />

            <PaymentResult
                doPrint={doPrint}
                onChargeRest={onChargeRest}
                onNextAccount={onNextAccount}
                result={result}
            />

            <PaymentErrors
                netError={netError}
                stale={stale}
            />
        </section>
    );
}
