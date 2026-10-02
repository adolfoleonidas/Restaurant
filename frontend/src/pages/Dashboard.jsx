import React, { useEffect, useState } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useNotify } from '@/contexts/NotifyContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, ChefHat, Clock, Wallet } from 'lucide-react';

export default function Dashboard() {
    const { user } = useAuth();
    const { generation } = useNotify();
    const [params, setParams] = useSearchParams();
    const [fetchedAt, setFetchedAt] = useState(Date.now());
    const [now, setNow] = useState(Date.now());
    const [approval, setApproval] = useState(null);
    const [note, setNote] = useState('');

    const { data, error } = usePolling(
        () => api.get('/reports/today').then((r) => {
            setFetchedAt(Date.now());
            return r.data;
        }),
        12000,
        [generation]
    );

    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 15000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const id = params.get('approval');
        if (!id || !data?.attention) return;
        const hit = data.attention.find((a) => a.kind === 'approval' && a.approval_id === id);
        if (hit) setApproval(hit.payload || hit);
    }, [params, data]);

    if (user?.role === 'mozo') return <Navigate to="/mesas" replace />;
    if (user?.role === 'cocina') return <Navigate to="/cocina" replace />;
    if (user?.role === 'cajero') return <Navigate to="/caja" replace />;

    const staleMin = Math.floor((now - fetchedAt) / 60000);
    const stale = !!error || staleMin >= 2;
    const attention = data?.attention || [];
    const summary = data?.summary || {};

    const decide = async (action) => {
        if (!approval?.id) return;
        try {
            await api.post(`/approvals/${approval.id}/decide`, { action, note: note.trim() || undefined });
            toast.success(action === 'approve' ? 'Autorizado. El solicitante ve el resultado en el historial.' : 'Solicitud rechazada.');
            setApproval(null);
            setNote('');
            setParams({});
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo resolver');
        }
    };

    return (
        <div className="space-y-6" data-testid="dashboard-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Hoy</p>
                    <h1 className="font-display text-3xl md:text-4xl font-semibold">Turno en curso</h1>
                    <p className="text-muted-foreground">
                        {stale
                            ? `Sin actualizar desde hace ${Math.max(staleMin, 2)} min`
                            : 'Primero lo que necesita atención'}
                    </p>
                </div>
            </div>

            <Card className={attention.length ? 'border-accent' : ''} data-testid="hoy-atencion">
                <CardContent className="p-5 space-y-3">
                    <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-accent" /> Necesita atención
                    </h2>
                    {attention.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nada urgente en este momento.</p>
                    ) : (
                        <div className="divide-y">
                            {attention.map((a, i) => (
                                <div key={a.approval_id || a.order_id || a.product_id || i} className="py-3 flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-medium">{a.title}</div>
                                        <div className="text-sm text-muted-foreground">{a.body}</div>
                                    </div>
                                    {a.kind === 'approval' ? (
                                        <Button size="sm" className="h-10 shrink-0" onClick={() => setApproval(a.payload || a)}>Revisar</Button>
                                    ) : (
                                        <Button size="sm" className="h-10 shrink-0" asChild>
                                            <Link to={a.href || '/dashboard'}>Ver <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card data-testid="hoy-resumen">
                <CardContent className="p-5">
                    <h2 className="font-display text-lg font-semibold mb-3">Resumen del turno</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                            <div className="text-xs text-muted-foreground">Mesas</div>
                            <div className="font-mono text-xl font-semibold">{summary.occupied_tables ?? '—'} / {summary.total_tables ?? '—'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">En preparación</div>
                            <div className="font-mono text-xl font-semibold">{summary.kitchen_orders ?? '—'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Cuentas solicitadas</div>
                            <div className="font-mono text-xl font-semibold">{summary.bill_requests ?? '—'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Caja</div>
                            <div className="font-semibold">{summary.cash_open ? 'Abierta' : 'Cerrada'}</div>
                            {summary.cash_opened_by && <div className="text-xs text-muted-foreground">{summary.cash_opened_by}</div>}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4">
                        <Button variant="secondary" asChild><Link to="/mesas"><Clock className="h-4 w-4 mr-1" />Operación</Link></Button>
                        <Button variant="secondary" asChild><Link to="/cocina"><ChefHat className="h-4 w-4 mr-1" />Cocina</Link></Button>
                        <Button variant="secondary" asChild><Link to="/caja"><Wallet className="h-4 w-4 mr-1" />Caja</Link></Button>
                        <Button variant="outline" asChild><Link to="/reportes">Reportes del período</Link></Button>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={!!approval} onOpenChange={(o) => { if (!o) { setApproval(null); setNote(''); } }}>
                <DialogContent data-testid="hoy-approval-dialog">
                    <DialogHeader><DialogTitle>Solicitud de {approval?.kind === 'refund' ? 'devolución' : 'anulación'}</DialogTitle></DialogHeader>
                    {approval && (
                        <div className="space-y-2 text-sm">
                            <div>Pedido #{approval.order_number} · {approval.method} · {approval.amount}</div>
                            <div>Solicitado por: {approval.requested_by_name} — {approval.requested_by_role}</div>
                            <div>Motivo: {approval.reason}</div>
                            <p className="text-muted-foreground">
                                Autorizar anula el cobro, reabre la cuenta y deja el registro. No borra el historial y no detiene sola la cocina.
                            </p>
                            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cómo se resuelve cocina, si el plato sigue en fuego" />
                        </div>
                    )}
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => decide('reject')}>Rechazar</Button>
                        <Button onClick={() => decide('approve')} data-testid="hoy-autorizar">Autorizar anulación</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
