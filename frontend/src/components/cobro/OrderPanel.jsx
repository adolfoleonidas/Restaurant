import React from 'react';
import ScopeTabs from '@/components/cobro/ScopeTabs';
import LineItems from '@/components/cobro/LineItems';
import ChargeSummary from '@/components/cobro/ChargeSummary';
import DiscountFields from '@/components/cobro/DiscountFields';
import TotalRow from '@/components/cobro/TotalRow';

/**
 * Left panel: scope, account detail, charge summary and total.
 */
export default function OrderPanel({
    acct, baseTotal, canDiscount, chargeAmount,
    d, detailOpen, discount, discountReason,
    handleTipChip, itemsAmount, part, partsN,
    payMode, people, picked, scopeCaption,
    setDetailOpen, setDiscount, setDiscountReason, setPart,
    setPayMode, setPeople, setPicked, setTip,
    setTipPct, tip, tipInvalid, tipPct,
    tipVal, total,
}) {
    return (
        <section className="order-panel" aria-label="Detalle y total de la cuenta">
            <ScopeTabs
                part={part}
                payMode={payMode}
                people={people}
                setDetailOpen={setDetailOpen}
                setPart={setPart}
                setPayMode={setPayMode}
                setPeople={setPeople}
            />

            <LineItems
                acct={acct}
                detailOpen={detailOpen}
                payMode={payMode}
                picked={picked}
                setDetailOpen={setDetailOpen}
                setPicked={setPicked}
            />

            <ChargeSummary
                baseTotal={baseTotal}
                canDiscount={canDiscount}
                d={d}
                handleTipChip={handleTipChip}
                itemsAmount={itemsAmount}
                partsN={partsN}
                payMode={payMode}
                setTip={setTip}
                setTipPct={setTipPct}
                tip={tip}
                tipInvalid={tipInvalid}
                tipPct={tipPct}
                tipVal={tipVal}
            />

            <DiscountFields
                canDiscount={canDiscount}
                d={d}
                discount={discount}
                discountReason={discountReason}
                setDiscount={setDiscount}
                setDiscountReason={setDiscountReason}
            />

            <TotalRow
                chargeAmount={chargeAmount}
                payMode={payMode}
                scopeCaption={scopeCaption}
                tip={tip}
                total={total}
            />
        </section>
    );
}
