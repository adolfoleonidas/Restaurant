import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { BarChart3, TrendingUp, ShoppingCart, Ban, Printer, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';

const COLORS = ['#1F6F66', '#C65A3D', '#F59E0B', '#3B82F6', '#22C55E', '#8B5CF6'];

const PERIOD_LABELS = { day: 'Hoy', week: 'Últimos 7 días', month: 'Últimos 30 días' };

function exportCsv(data, period) {
    const rows = [
        ['Reporte de ventas', PERIOD_LABELS[period] || period],
        [],
        ['Total ventas', data.total_sales],
        ['Pedidos pagados', data.orders_count],
        ['Ticket promedio', data.avg_ticket],
        ['Cancelados', data.cancelled_orders],
        [],
        ['Ventas por día'],
        ...(data.sales_by_day || []).map((d) => [d.date, d.amount]),
        [],
        ['Por método de pago'],
        ...(data.by_method || []).map((m) => [PAYMENT_LABELS[m.method] || m.method, m.amount]),
        [],
        ['Productos más vendidos'],
        ...(data.top_products || []).map((p) => [p.name, p.quantity, p.revenue]),
    ];
    const csv = rows.map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function Reportes() {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);

    useEffect(() => {
        api.get('/reports/sales', { params: { period } }).then((r) => setData(r.data));
    }, [period]);

    const doPrint = () => {
        window.print();
    };

    return (
        <div className="space-y-6" data-testid="reportes-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <p className="page-kicker mb-1">Análisis</p>
                    <h1 className="font-display italic text-3xl font-semibold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Reportes</h1>
                    <p className="text-sm text-muted-foreground mt-1">Ventas, productos y métodos de pago del período.</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day" data-testid="reportes-periodo-day">Hoy</TabsTrigger>
                            <TabsTrigger value="week" data-testid="reportes-periodo-week">7 días</TabsTrigger>
                            <TabsTrigger value="month" data-testid="reportes-periodo-month">30 días</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    {data && (
                        <>
                            <Button variant="outline" size="sm" onClick={doPrint} data-testid="reportes-print"><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
                            <Button variant="outline" size="sm" onClick={() => exportCsv(data, period)} data-testid="reportes-export"><Download className="h-4 w-4 mr-1" />CSV</Button>
                        </>
                    )}
                </div>
            </div>

            {!data ? (
                <div className="text-muted-foreground">Cargando reporte…</div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div><div className="text-xs uppercase text-muted-foreground tracking-wide">Total ventas</div>
                                    <div className="font-display text-2xl font-semibold tabular-nums mt-1" data-testid="reportes-total-ventas">{fmtMoney(data.total_sales)}</div></div>
                                <TrendingUp className="h-6 w-6 text-primary" />
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div><div className="text-xs uppercase text-muted-foreground tracking-wide">Pedidos pagados</div>
                                    <div className="font-display text-2xl font-semibold tabular-nums mt-1">{data.orders_count}</div></div>
                                <ShoppingCart className="h-6 w-6 text-primary" />
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div><div className="text-xs uppercase text-muted-foreground tracking-wide">Ticket promedio</div>
                                    <div className="font-display text-2xl font-semibold tabular-nums mt-1">{fmtMoney(data.avg_ticket)}</div></div>
                            </div>
                        </CardContent></Card>
                        <Card><CardContent className="p-5">
                            <div className="flex items-center justify-between">
                                <div><div className="text-xs uppercase text-muted-foreground tracking-wide">Cancelados</div>
                                    <div className="font-display text-2xl font-semibold tabular-nums mt-1">{data.cancelled_orders}</div></div>
                                <Ban className="h-6 w-6 text-destructive" />
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
