import React from 'react';
import { fmtMoney, fmtDateTime } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import AttentionReference from '@/components/AttentionReference';

/**
 * Previous visits of the table.
 */
export default function TableHistory({
    branchNames, history, order,
}) {
    return (
        <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Turnos anteriores</div>
            <div className="border rounded-xl divide-y">
                {history.map((o) => (
                    <div key={o.id} className="py-2 px-3 flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                            <div className="font-medium truncate">#{o.order_number} · {ORDER_STATUS_LABELS[o.status] || o.status}</div>
                            <AttentionReference order={o} branchNames={branchNames} />
                            <div className="text-xs text-muted-foreground">{fmtDateTime(o.created_at)}</div>
                        </div>
                        <span className="font-mono font-semibold tabular-nums shrink-0">{fmtMoney(o.total)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
