import React from 'react';

/** Payment proof image of an order, or a note when the customer sent none. */
export default function ProofPreview({
    url, maxHeightClass, emptyText, emptyAs: Empty = 'div',
}) {
    if (url) {
        return <img src={url} alt="Comprobante" className={`mt-2 ${maxHeightClass} rounded-sm border`} />;
    }
    return <Empty className="mt-2 text-xs text-muted-foreground">{emptyText}</Empty>;
}
