import React from 'react';
import { METHOD_MAP } from '@/lib/paymentMethods';
import { METHODS } from '@/components/cobro/constants';

/**
 * Heading and the rail of payment methods.
 */
export default function MethodRail({
    method, proofIntent, proofSent, selectMethod, locked,
}) {
    return (
        <>
            {/* Method heading */}
            <div className="method-heading">
                <h2 className="section-heading">Metodo de pago</h2>
            </div>

            {/* Method Rail */}
            <div className="method-rail-wrap">
                <div className="method-rail" role="tablist">
                    {METHODS.map((m, i) => (
                        <button key={m.id} className="method" role="tab" data-method={m.id}
                            data-testid={`caja-metodo-${METHOD_MAP[m.id]}`}
                            aria-selected={method === m.id}
                            disabled={Boolean(locked || (proofIntent && !proofSent))}
                            onClick={() => selectMethod(m.id)}>
                            <kbd aria-hidden="true">{i + 1}</kbd>
                            <m.Icon style={{ width: 23, height: 23 }} />
                            <span>{m.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
