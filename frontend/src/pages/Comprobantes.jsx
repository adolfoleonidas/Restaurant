import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { listPaymentProofs } from '@/lib/api/payments';
import { getOrder } from '@/lib/api/orders';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtMoney, fmtDateTime, PAYMENT_LABELS } from '@/lib/format';
import { proofPending, orderPaymentStatusLabel } from '@/constants/status';
import { Search, Receipt, Image as ImageIcon, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeGeneration } from '@/contexts/NotifyContext';
import useBranchNames from '@/hooks/useBranchNames';
import { toast } from 'sonner';

/**
 * Comprobantes — review of the Yape/Plin captures uploaded against an account.
 * The list is metadata-only; the base64 image is loaded on demand from the order.
 */

const FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Pendientes de revisión' },
];

export default function Comprobantes() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const branchNames = useBranchNames(user?.restaurant_id && user?.id ? `${user.restaurant_id}:${user.id}` : null);
    const generation = useRealtimeGeneration(['payments', 'prepay']);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [detail, setDetail] = useState(null);

    const { data, refetch } = usePolling(
        () => listPaymentProofs(filter === 'pending' ? { pending: true } : {}).then((r) => r.data),
        10000,
        [filter, generation]
    );

    const items = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
    const pendingCount = data?.pending ?? items.filter((it) => proofPending(it)).length;

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter((it) => [
            it.order_number,
            it.customer_name,
            it.table?.number,
            it.table?.name,
            it.payment_proof_method,
            it.payment_proof_uploaded_by_name,
        ].some((value) => String(value ?? '').toLowerCase().includes(q)));
    }, [items, search]);

    const openDetail = async (row) => {
        setDetail({ row, image: null, loading: true });
        try {
            const { data: order } = await getOrder(row.id);
            setDetail({ row: { ...row, ...order }, image: order?.payment_proof_url || null, loading: false });
        } catch {
            toast.error('No se pudo cargar el comprobante');
            setDetail((current) => (current ? { ...current, loading: false } : current));
        }
    };

    const place = (row) => {
        if (row.table?.number || row.table_number) return `Mesa ${row.table?.number ?? row.table_number}`;
        if (row.customer_name) return row.customer_name;
        if (row.source === 'public') return 'Cliente web';
        return 'Para llevar';
    };

    return (
        <div className="space-y-5" data-testid="comprobantes-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Caja</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
                        <Receipt className="h-6 w-6 text-primary" /> Comprobantes
                    </h1>
                    <p className="text-sm text-muted-foreground" data-testid="comprobantes-resumen">
                        {pendingCount} pendiente{pendingCount === 1 ? '' : 's'} de revisión · capturas de Yape/Plin
                    </p>
                </div>
                <div className="relative">
                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9 w-52" placeholder="Buscar pedido o mesa" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="comprobantes-search" />
                </div>
            </div>

            <div className="flex gap-2 flex-wrap" data-testid="comprobantes-filtros">
                {FILTERS.map((f) => (
                    <Button
                        key={f.key}
                        variant={filter === f.key ? 'default' : 'outline'}
                        className="h-11 sm:h-10"
                        onClick={() => setFilter(f.key)}
                        data-testid={`comprobantes-filtro-${f.key}`}
                    >
                        {f.label}
                    </Button>
                ))}
                <Button variant="outline" className="h-11 sm:h-10" onClick={() => refetch?.()} data-testid="comprobantes-refresh">Actualizar</Button>
            </div>

            {visible.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground border rounded-xl">
                    {filter === 'pending' ? 'No hay comprobantes pendientes de revisión.' : 'Todavía no hay comprobantes subidos.'}
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {visible.map((row) => {
                        const isPending = proofPending(row);
                        const missing = Number(row.total || 0) - Number(row.amount_paid || 0);
                        return (
                            <Card key={row.id} data-testid={`comprobantes-row-${row.order_number}`}>
                                <CardContent className="p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-display text-xl font-bold flex items-center gap-2">
                                                #{row.order_number}
                                                <span className="text-sm font-normal text-muted-foreground">{place(row)}</span>
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {PAYMENT_LABELS[row.payment_proof_method] || row.payment_proof_method || 'Comprobante'}
                                                {' · '}
                                                {row.payment_proof_uploaded_at ? fmtDateTime(row.payment_proof_uploaded_at) : '—'}
                                                {row.payment_proof_uploaded_by_name ? ` · ${row.payment_proof_uploaded_by_name}` : ''}
                                            </div>
                                            {row.branch_id && branchNames?.[row.branch_id] && (
                                                <div className="text-xs text-muted-foreground">{branchNames[row.branch_id]}</div>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-mono font-bold tabular-nums">{fmtMoney(row.total)}</div>
                                            <div className={`text-xs font-medium flex items-center gap-1 justify-end ${isPending ? 'text-blue-600 dark:text-blue-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                                {isPending ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                                                {orderPaymentStatusLabel(row)}
                                            </div>
                                            {missing > 0.009 && isPending && (
                                                <div className="text-xs text-muted-foreground">Resta {fmtMoney(missing)}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Button size="sm" variant="outline" onClick={() => openDetail(row)} data-testid={`comprobantes-ver-${row.order_number}`}>
                                            <ImageIcon className="h-4 w-4 mr-1.5" /> Ver comprobante
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => navigate(`/pedidos/${row.id}`)} data-testid={`comprobantes-pedido-${row.order_number}`}>
                                            Abrir pedido
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}>
                <DialogContent className="max-w-2xl" data-testid="comprobantes-dialog">
                    <DialogHeader>
                        <DialogTitle>
                            {detail?.row?.order_number ? `Comprobante del pedido #${detail.row.order_number}` : 'Comprobante'}
                        </DialogTitle>
                    </DialogHeader>
                    {detail?.loading ? (
                        <p className="text-sm text-muted-foreground">Cargando comprobante…</p>
                    ) : detail?.image ? (
                        <div className="space-y-3">
                            {/* 60dvh: en apaisado (390 px de alto) la captura no queda legible; el tope en px
                                evita que en vertical se coma el diálogo, y el enlace abre el original a tamaño real */}
                            <img src={detail.image} alt="Comprobante" className="max-h-[min(60dvh,420px)] w-auto mx-auto rounded-lg border border-border" data-testid="comprobantes-imagen" />
                            <div className="text-xs text-muted-foreground text-center">
                                {PAYMENT_LABELS[detail.row.payment_proof_method] || detail.row.payment_proof_method || 'Comprobante'}
                                {' · '}
                                {fmtMoney(detail.row.total)}
                                {detail.row.payment_proof_uploaded_at ? ` · ${fmtDateTime(detail.row.payment_proof_uploaded_at)}` : ''}
                            </div>
                            <div className="flex justify-center gap-2 flex-wrap">
                                <Button variant="outline" asChild>
                                    <a href={detail.image} target="_blank" rel="noreferrer" data-testid="comprobantes-imagen-abrir">
                                        <ExternalLink className="h-4 w-4 mr-1.5" /> Ver a tamaño completo
                                    </a>
                                </Button>
                                <Button variant="outline" onClick={() => { const id = detail.row.id; setDetail(null); navigate(`/pedidos/${id}`); }}>
                                    Ir al pedido
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No hay imagen de comprobante para este pedido.</p>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
