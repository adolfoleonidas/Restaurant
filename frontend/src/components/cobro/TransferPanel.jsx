import React from 'react';

/**
 * Bank transfer data.
 */
export default function TransferPanel({
    method,
}) {
    return (
        <>
            {/* TRANSFER PANEL */}
            {method === 'transfer' && (
                <div className="transfer-data">
                    <dl className="account-data">
                        <div className="data-row"><dt>Banco</dt><dd>Banco de muestra</dd></div>
                        <div className="data-row"><dt>Cuenta / CCI</dt><dd>Configura los datos de tu negocio</dd></div>
                        <div className="data-row"><dt>Titular</dt><dd>Sabor Peruano S.A.C.</dd></div>
                    </dl>
                </div>
            )}
        </>
    );
}
