import useOrderProof from '@/hooks/useOrderProof';
import ProofPreview from '@/components/ProofPreview';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/StateBadge';
import { fmtMoney, PAYMENT_LABELS, ORDER_TYPE_LABELS } from '@/lib/format';

export default function WebOrderRow({ order, onConfirm, scopeParams = {} }) {
    const { proof, loading, openProof } = useOrderProof(scopeParams);

    return (
        <div className="py-3 flex items-start justify-between gap-3" data-testid={`caja-web-${order.order_number}`}>
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display text-lg font-bold">#{order.order_number}</span>
                    <StateBadge status={order.status} type="order" />
                    <span className="text-xs text-muted-foreground">{ORDER_TYPE_LABELS[order.order_type] || order.order_type}</span>
                </div>
                <div className="text-sm truncate">{order.customer_name || 'Cliente web'} · {order.customer_phone || '—'}</div>
                <div className="text-xs text-muted-foreground">
                    {PAYMENT_LABELS[order.payment_method_choice] || 'Pago'} · {order.payment_status === 'comprobante_subido' ? 'Comprobante subido' : 'Sin comprobante'}
                </div>
                {proof && <ProofPreview url={proof.url} maxHeightClass="max-h-40" emptyText="No hay imagen de comprobante." />}
            </div>
            <div className="text-right shrink-0 space-y-1">
                <div className="font-mono font-bold tabular-nums">{fmtMoney(order.total)}</div>
                <Button size="sm" variant="outline" className="h-11 w-full" onClick={() => openProof(order)} disabled={loading}>Ver comprobante</Button>
                <Button size="sm" className="h-11 w-full" onClick={onConfirm} data-testid={`caja-confirmar-web-${order.order_number}`}>Confirmar</Button>
            </div>
        </div>
    );
}
