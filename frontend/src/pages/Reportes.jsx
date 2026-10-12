import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIONS, can } from '@/lib/permissions';
import { getSalesReport } from '@/lib/api/reports';
import { listBranches } from '@/lib/api/branches';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { BarChart3, TrendingUp, ShoppingCart, Ban, Printer, FileDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#1F6F66', '#C65A3D', '#F59E0B', '#3B82F6', '#22C55E', '#8B5CF6'];

function exportCsv(data) {
    if (!data) return;
    const rows = [['Reporte de ventas']];
    rows.push(['Total ventas', data.total_sales]);
    rows.push(['Pedidos pagados', data.orders_count]);
    rows.push(['Ticket promedio', data.avg_ticket]);
    rows.push(['Cancelados', data.cancelled_orders]);
    rows.push([]);
    rows.push(['Ventas por día']);
    rows.push(['Fecha', 'Monto']);
    (data.sales_by_day || []).forEach((d) => rows.push([d.date, d.amount]));
    rows.push([]);
    rows.push(['Por método de pago']);
    rows.push(['Método', 'Monto']);
    (data.by_method || []).forEach((m) => rows.push([m.method, m.amount]));
    rows.push([]);
    rows.push(['Productos más vendidos']);
    rows.push(['Producto', 'Cantidad', 'Ingresos']);
    (data.top_products || []).forEach((p) => rows.push([p.name, p.quantity, p.revenue]));
    const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-${data.period || 'ventas'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function Reportes() {
    const { user } = useAuth();
    const isOwner = can(user, ACTIONS.OWNER);
    const userKey = JSON.stringify([
        user?.id || user?.email || 'signed-in',
        user?.restaurant_id,
        user?.role,
        [...(user?.functions || [])].sort(),
    ]);

    return <ReportesView key={userKey} userKey={userKey} isOwner={isOwner} />;
}

function ReportesView({ userKey, isOwner }) {
    const [period, setPeriod] = useState('day');
    const [context, setContext] = useState('all');
    const [catalog, setCatalog] = useState({ userKey, branches: [], loading: isOwner, error: false });
    const [result, setResult] = useState({ key: null, data: null, loading: true, error: null });

    useEffect(() => {
        if (!isOwner) {
            setCatalog({ userKey, branches: [], loading: false, error: false });
            return undefined;
        }

        let active = true;
        setCatalog({ userKey, branches: [], loading: true, error: false });
        listBranches().then(({ data: branchData }) => {
            if (!active) return;
            setCatalog({ userKey, branches: Array.isArray(branchData) ? branchData : [], loading: false, error: false });
        }).catch(() => {
            if (active) setCatalog({ userKey, branches: [], loading: false, error: true });
        });
        return () => { active = false; };
    }, [isOwner, userKey]);

    const visibleCatalog = catalog.userKey === userKey
        ? catalog : { userKey, branches: [], loading: true, error: false };
    const selectedBranchId = context.startsWith('branch:') ? context.slice('branch:'.length) : null;
    const selectedBranch = selectedBranchId && visibleCatalog.branches.find(
        (branch) => String(branch.id) === selectedBranchId
    );
    const contextUnavailable = context === 'invalid' || !!selectedBranchId
        && (visibleCatalog.loading || visibleCatalog.error || !selectedBranch);
    const requestKey = `${userKey}:${context}:${period}`;
    const visibleResult = result.key === requestKey ? result : { data: null, error: null };
    const data = visibleResult.data;

    useEffect(() => {
        let active = true;
        if (contextUnavailable) {
            setResult({ key: requestKey, data: null, loading: false, error: null });
            return () => { active = false; };
        }

        setResult({ key: requestKey, data: null, loading: true, error: null });
        const params = { period };
        if (context === 'legacy') params.legacy_only = true;
        else if (selectedBranchId) params.branch_id = selectedBranchId;

        getSalesReport(params).then(({ data: reportData }) => {
            if (active) setResult({ key: requestKey, data: reportData, loading: false, error: null });
        }).catch((error) => {
            if (!active) return;
            setResult({ key: requestKey, data: null, loading: false, error });
            if (selectedBranchId && error?.response?.status === 404) {
                setContext((current) => current === context ? 'invalid' : current);
            }
        });
        return () => { active = false; };
    }, [context, contextUnavailable, period, requestKey, selectedBranchId, userKey]);

    const scopeDescription = context === 'legacy'
        ? 'Este reporte incluye solo registros históricos sin sucursal.'
        : selectedBranch
            ? `Este reporte incluye las ventas de ${selectedBranch.name}.`
            : 'Este reporte consolida las ventas de todas las sucursales.';

    return (
        <div className="space-y-5" data-testid="reportes-root">
            <p className="page-kicker mb-1">Administración</p>
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2 min-w-0"><BarChart3 className="h-6 w-6 text-primary shrink-0" /> <span className="truncate">Reportes</span></h1>
                    <p className="text-muted-foreground text-sm">Ventas, productos y métodos de pago.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {isOwner && (
                        <label htmlFor="reportes-branch-context" className="flex flex-col gap-1 text-sm min-w-0">
                            Contexto de sucursal
                            <select
                                id="reportes-branch-context"
                                data-testid="reportes-branch-context"
                                className="h-11 w-full min-w-0 sm:min-w-52 rounded-md border border-border bg-background px-3"
                                value={context}
                                onChange={(event) => {
                                    const next = event.target.value;
                                    if (next === 'all' || next === 'legacy'
                                        || visibleCatalog.branches.some((branch) => `branch:${branch.id}` === next)) {
                                        setContext(next);
                                    }
                                }}
                            >
                                <option value="all">Todas las sucursales · consolidado</option>
                                {visibleCatalog.branches.map((branch) => (
                                    <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>
                                ))}
                                <option value="legacy">Registros históricos sin sucursal</option>
                                {context === 'invalid' && <option value="invalid">Sucursal no disponible</option>}
                            </select>
                        </label>
                    )}
                    <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Imprimir</Button>
                    <Button data-testid="reportes-export" variant="outline" onClick={() => exportCsv(data)} disabled={!data}><FileDown className="h-4 w-4 mr-2" />Exportar CSV</Button>
                    {/* Selector de período: grupo de toggles (no pestañas), con
                        aria-pressed y un objetivo táctil de 44 px en móvil */}
                    <ToggleGroup
                        type="single"
                        value={period}
                        onValueChange={(v) => v && setPeriod(v)}
                        aria-label="Período del reporte"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                    >
                        <ToggleGroupItem value="day" data-testid="reportes-periodo-day" className="min-h-11 sm:min-h-9">Hoy</ToggleGroupItem>
                        <ToggleGroupItem value="week" data-testid="reportes-periodo-week" className="min-h-11 sm:min-h-9">7 días</ToggleGroupItem>
                        <ToggleGroupItem value="month" data-testid="reportes-periodo-month" className="min-h-11 sm:min-h-9">30 días</ToggleGroupItem>
                    </ToggleGroup>
                </div>
            </div>

            {isOwner && visibleCatalog.loading && <p className="text-sm text-muted-foreground">Cargando sucursales…</p>}
            {isOwner && visibleCatalog.error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las sucursales. La selección por sucursal no está disponible.</p>}
            {isOwner && !contextUnavailable && (
                <p className="text-sm text-muted-foreground" data-testid="reportes-scope-description">
                    {scopeDescription}
                </p>
            )}
            {contextUnavailable ? (
                <p role="alert" className="text-sm text-destructive">No se puede consultar esta sucursal con la información disponible.</p>
            ) : !data ? (
                visibleResult.error
                    ? <p role="alert" className="text-sm text-destructive">No se pudo cargar el reporte de ventas.</p>
                    : <div className="text-muted-foreground">Cargando reporte…</div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0"><div className="text-xs uppercase text-muted-foreground tracking-wide">Total ventas</div>
                                    <div className="font-display text-xl sm:text-2xl font-semibold tabular-nums mt-1" data-testid="reportes-total-ventas">{fmtMoney(data.total_sales)}</div></div>
                                <TrendingUp className="h-6 w-6 text-primary shrink-0" />
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0"><div className="text-xs uppercase text-muted-foreground tracking-wide">Pedidos pagados</div>
                                    <div className="font-display text-xl sm:text-2xl font-semibold tabular-nums mt-1">{data.orders_count}</div></div>
                                <ShoppingCart className="h-6 w-6 text-primary shrink-0" />
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0"><div className="text-xs uppercase text-muted-foreground tracking-wide">Ticket promedio</div>
                                    <div className="font-display text-xl sm:text-2xl font-semibold tabular-nums mt-1">{fmtMoney(data.avg_ticket)}</div></div>
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="min-w-0"><div className="text-xs uppercase text-muted-foreground tracking-wide">Cancelados</div>
                                    <div className="font-display text-xl sm:text-2xl font-semibold tabular-nums mt-1">{data.cancelled_orders}</div></div>
                                <Ban className="h-6 w-6 text-destructive shrink-0" />
                            </div>
                        </CardContent></Card>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <Card><CardContent className="p-5">
                            <h2 className="font-display text-lg font-semibold mb-3">Ventas por día</h2>
                            {(data.sales_by_day || []).length === 0 ? (
                                <div className="py-12 text-center text-muted-foreground text-sm">Sin datos</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={data.sales_by_day}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#E7DED5" />
                                        <XAxis dataKey="date" fontSize={12} />
                                        <YAxis fontSize={12} />
                                        <Tooltip formatter={(v) => fmtMoney(v)} />
                                        <Bar dataKey="amount" fill="#1F6F66" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent></Card>

                        <Card><CardContent className="p-5">
                            <h2 className="font-display text-lg font-semibold mb-3">Por método de pago</h2>
                            {(data.by_method || []).length === 0 ? (
                                <div className="py-12 text-center text-muted-foreground text-sm">Sin datos</div>
                            ) : (
                                <div className="flex flex-col md:flex-row items-center gap-4">
                                    <ResponsiveContainer width="100%" height={220}>
                                        <PieChart>
                                            <Pie data={data.by_method} dataKey="amount" nameKey="method" outerRadius={80} label>
                                                {data.by_method.map((entry, i) => <Cell key={entry.method} fill={COLORS[i % COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip formatter={(v) => fmtMoney(v)} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="flex-1 space-y-1.5">
                                        {data.by_method.map((m, i) => (
                                            <div key={m.method} className="flex items-center justify-between text-sm">
                                                <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} /><span>{PAYMENT_LABELS[m.method] || m.method}</span></div>
                                                <span className="tabular-nums font-semibold">{fmtMoney(m.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent></Card>
                    </div>

                    <Card><CardContent className="p-5">
                        <h2 className="font-display text-lg font-semibold mb-3">Productos más vendidos</h2>
                        {(data.top_products || []).length === 0 ? (
                            <div className="py-8 text-center text-muted-foreground text-sm">Sin datos</div>
                        ) : (
                            <div className="divide-y">
                                {data.top_products.map((p, i) => (
                                    <div key={p.product_id} className="flex items-center justify-between py-3">
                                        <div className="flex items-center gap-3">
                                            <span className="h-7 w-7 flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">{i + 1}</span>
                                            <span className="font-medium">{p.name}</span>
                                        </div>
                                        <div className="flex items-center gap-6 text-sm">
                                            <span className="text-muted-foreground">{p.quantity} u.</span>
                                            <span className="tabular-nums font-semibold">{fmtMoney(p.revenue)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent></Card>
                </>
            )}
        </div>
    );
}
