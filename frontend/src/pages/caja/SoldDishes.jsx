import { useState, useEffect } from 'react';
import { getProductsReport } from '@/lib/api/reports';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtMoney } from '@/lib/format';

export default function SoldDishes({ refreshKey, scopeParams = {}, contextKey = 'staff', branchName = null }) {
    const [period, setPeriod] = useState('day');
    const [result, setResult] = useState(null);
    const requestIdentity = JSON.stringify([contextKey, period, refreshKey, scopeParams]);
    const currentResult = result?.identity === requestIdentity ? result : null;
    const data = currentResult?.data || null;
    const failed = currentResult?.failed || false;

    useEffect(() => {
        let active = true;
        getProductsReport({ period, ...scopeParams }).then((r) => {
            if (active) setResult({ identity: requestIdentity, data: r.data, failed: false });
        }).catch(() => {
            if (active) setResult({ identity: requestIdentity, data: null, failed: true });
        });
        return () => { active = false; };
    }, [period, refreshKey, scopeParams, contextKey, requestIdentity]);

    return (
        <Card data-testid="caja-historial-platos">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Platos vendidos</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day">Hoy</TabsTrigger>
                            <TabsTrigger value="week">Semana</TabsTrigger>
                            <TabsTrigger value="month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                {scopeParams.branch_id && branchName && <p className="text-xs text-muted-foreground">Reporte de platos para la sucursal {branchName}.</p>}
                {scopeParams.legacy_only && <p className="text-xs text-muted-foreground">Reporte de platos de registros históricos sin sucursal.</p>}
                {data && (
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-xs text-muted-foreground">Unidades</div>
                            <div className="font-mono font-semibold tabular-nums">{data.total_units || 0}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Importe de platos</div>
                            <div className="font-mono font-semibold tabular-nums">{fmtMoney(data.total_revenue)}</div>
                        </div>
                    </div>
                )}
                {failed ? (
                    <div role="alert" className="text-sm text-destructive">No se pudo cargar el reporte de platos para este contexto.</div>
                ) : !data ? (
                    <div className="text-sm text-muted-foreground">Cargando platos…</div>
                ) : !(data.products || []).length ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">Todavía no hay platos cobrados en este período.</div>
                ) : (
                    <div className="divide-y border border-border rounded-sm">
                        {data.products.map((p) => (
                            <div key={p.product_id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm" data-testid={`caja-plato-${p.product_id}`}>
                                <div className="font-medium">{p.name}</div>
                                <div className="text-right">
                                    <div className="font-mono font-semibold tabular-nums">{p.quantity} u.</div>
                                    <div className="text-xs text-muted-foreground">{fmtMoney(p.revenue)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
