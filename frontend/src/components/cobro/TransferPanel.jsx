import React from 'react';

/**
 * Bank transfer data from the restaurant settings. Without configured data the
 * panel stays hidden: it never shows sample values.
 */
export default function TransferPanel({
    method, transfer,
}) {
    if (method !== 'transfer') return null;
    const rows = [
        ['Banco', transfer?.bank_name],
        ['Cuenta', transfer?.bank_account],
        ['CCI', transfer?.bank_cci],
        ['Titular', transfer?.bank_holder],
    ].filter(([, value]) => Boolean(value && String(value).trim()));
    if (rows.length === 0) return null;
    return (
        <div className="transfer-data">
            <dl className="account-data">
                {rows.map(([label, value]) => (
                    <div className="data-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
            </dl>
        </div>
    );
}
