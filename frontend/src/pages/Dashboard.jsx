import React from 'react';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { fmtMoney, ROLE_LABELS } from '@/lib/format';
import { Receipt, Grid2X2, TrendingUp, Users, ChefHat, Wallet, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const Kpi = ({ icon: Icon, label, value, accent = 'primary', testId }) => (
    <Card className="shadow-sm">
        <CardContent className="p-5">
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                    <div className="mt-1 font-display text-3xl font-semibold tabular-nums" data-testid={testId}>{value}</div>
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent === 'primary' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </CardContent>
    </Card>
);

export default function Dashboard() {
    const { user } = useAuth();
    const { data } = usePolling(
        () => api.get('/reports/dashboard').then((r) => r.data),
        5000
    );

    const isAdmin = user.role === 'admin';
    const isCajero = user.role === 'cajero';

    return (
        <div className="space-y-6" data-testid="dashboard-root">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <h1 className="font-display text-2xl md:text-3xl font-semibold">Hola, {user.full_name.split(' ')[0]} 👋</h1>
                    <p className="text-muted-foreground">{ROLE_LABELS[user.role]} · Resumen del día</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(user.role === 'mozo' || user.role === 'admin') && (
                        <Button asChild data-testid="dashboard-cta-nuevo-pedido">
                            <Link to="/pedidos/nuevo"><Receipt className="h-4 w-4 mr-2" />Nuevo pedido</Link>
                        </Button>
                    )}
                    {(user.role === 'cocina' || user.role === 'admin') && (
                        <Button variant="secondary" asChild>
                            <Link to="/cocina"><ChefHat className="h-4 w-4 mr-2" />Ir a cocina</Link>
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                {(isAdmin || isCajero) && (
                    <>
                        <Kpi icon={TrendingUp} label="Ventas del día" value={fmtMoney(data?.daily_sales)} testId="kpi-ventas-hoy" />
                        <Kpi icon={Receipt} label="Pedidos pagados" value={data?.orders_paid ?? '—'} testId="kpi-pedidos-pagados" />
                        <Kpi icon={Wallet} label="Ticket promedio" value={fmtMoney(data?.avg_ticket)} testId="kpi-ticket-promedio" accent="accent" />
                    </>
                )}
                <Kpi icon={Receipt} label="Pedidos activos" value={data?.active_orders ?? '—'} testId="kpi-pedidos-activos" accent="accent" />
                <Kpi icon={Grid2X2} label="Mesas ocupadas" value={`${data?.occupied_tables ?? 0} / ${data?.total_tables ?? 0}`} testId="kpi-mesas-ocupadas" />
            </div>

            {isAdmin && (
                <Card>
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="font-display text-lg font-semibold">Top productos hoy</h2>
                            <Button variant="ghost" size="sm" asChild>
                                <Link to="/reportes">Ver reportes <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
                            </Button>
                        </div>
                        {(data?.top_products || []).length === 0 ? (
                            <div className="text-sm text-muted-foreground py-8 text-center">Aún no hay ventas hoy. ¡Buen turno!</div>
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
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
