import { useState, useEffect } from 'react';
import { listPendingPrepay, runPrepayAction } from '@/lib/api/payments';
import useOrderProof from '@/hooks/useOrderProof';
import ProofPreview from '@/components/ProofPreview';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/apiError';
import ConfirmDialog from '@/components/ConfirmDialog';

const PREPAY_STATE_LABELS = {
    pendiente: 'Esperando el pago del cliente',
    reportado: 'El cliente dice que ya pagó',
    rechazado: 'Pago rechazado',
};

/**
 * Cola de prepagos por verificar.
 *
 * Con prepago activo, un pedido por Yape/Plin/transferencia no llega a cocina
 * hasta que alguien comprueba que el dinero entró. Confirmar acá registra el
 * cobro y envía el pedido a cocina en un solo paso; rechazar lo deja fuera.
 */
export default function PrepayQueue({ runMutation, onChanged }) {
    const [rows, setRows] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState('');
    const [rejecting, setRejecting] = useState(null);
    const { proof, openProof, closeProof } = useOrderProof();
    const [load, setLoad] = useState(0);

    useEffect(() => {
        let active = true;
        listPendingPrepay()
            .then((r) => { if (active) setRows(Array.isArray(r.data) ? r.data : []); })
            .catch(() => { if (active) setRows([]); })
            .finally(() => { if (active) setLoaded(true); });
        return () => { active = false; };
    }, [load]);

    const reload = () => setLoad((n) => n + 1);

    const decide = async (row, action) => {
        setBusy(`${action}-${row.id}`);
        try {
            await runMutation(() => runPrepayAction(row.id, action));
            toast.success(action === 'confirm'
                ? `Pedido #${row.order_number}: pago registrado y enviado a cocina`
                : `Pedido #${row.order_number}: pago rechazado`);
            reload();
            onChanged?.();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo completar la acción'));
        } finally {
            setBusy('');
        }
    };

    if (!loaded || rows.length === 0) return null;

    return (
        <Card className="border-amber-500/50" data-testid="caja-prepagos">
            <CardContent className="p-4">
                <h2 className="font-display text-lg font-semibold mb-1">Prepagos por verificar ({rows.length})</h2>
                <p className="text-xs text-muted-foreground mb-3">
                    Verificá el pago en tu app antes de confirmar: recién ahí el pedido entra a cocina.
                </p>
                <div className="divide-y">
                    {rows.map((row) => (
                        <div key={row.id} className="py-3 flex items-start justify-between gap-3" data-testid={`caja-prepago-${row.order_number}`}>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-display text-lg font-bold">#{row.order_number}</span>
                                    {row.table_number ? <span className="text-sm font-medium">Mesa {row.table_number}</span> : null}
                                    <span className="text-xs text-muted-foreground">{PAYMENT_LABELS[row.payment_method_choice] || row.payment_method_choice}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {PREPAY_STATE_LABELS[row.payment_state] || row.payment_state}
                                    {' · '}{(row.items || []).reduce((s, i) => s + (i.quantity || 0), 0)} ítems
                                    {row.customer_name ? ` · ${row.customer_name}` : ''}
                                </div>
                            </div>
                            <div className="text-right shrink-0 space-y-1">
                                <div className="font-mono font-bold tabular-nums">{fmtMoney(row.total)}</div>
                                {row.has_proof && (
                                    <Button size="sm" variant="outline" className="h-11 w-full" onClick={() => openProof(row)} data-testid={`caja-prepago-ver-${row.order_number}`}>Ver comprobante</Button>
                                )}
                                <Button size="sm" className="h-11 w-full" disabled={!!busy} onClick={() => decide(row, 'confirm')} data-testid={`caja-prepago-confirmar-${row.order_number}`}>
                                    {busy === `confirm-${row.id}` ? 'Registrando…' : 'Confirmar pago'}
                                </Button>
                                <Button size="sm" variant="outline" className="h-11 w-full" disabled={!!busy} onClick={() => setRejecting(row)} data-testid={`caja-prepago-rechazar-${row.order_number}`}>Rechazar</Button>
                            </div>
                        </div>
                    ))}
                </div>
                {proof && (
                    <div className="mt-3 border-t pt-3" data-testid="caja-prepago-comprobante">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">Comprobante del pedido #{proof.order.order_number}</span>
                            <Button size="sm" variant="ghost" onClick={closeProof}>Cerrar</Button>
                        </div>
                        <ProofPreview url={proof.url} maxHeightClass="max-h-72" emptyText="El cliente todavía no subió imagen." emptyAs="p" />
                    </div>
                )}
            </CardContent>
            <ConfirmDialog
                open={Boolean(rejecting)}
                title={`¿Rechazar el pago del pedido #${rejecting?.order_number}?`}
                description="El pedido no va a cocina."
                confirmLabel="Rechazar"
                onCancel={() => setRejecting(null)}
                onConfirm={() => { const row = rejecting; setRejecting(null); decide(row, 'reject'); }}
            />
        </Card>
    );
}
