import React from 'react';
import AttentionReference from '@/components/AttentionReference';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import { fmtDateTime, fmtMoney } from '@/lib/format';

export default function TableHistory({ history, branchNames }) {
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
