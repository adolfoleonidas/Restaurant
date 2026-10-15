import { useState, useMemo, useEffect } from 'react';
import { listCashHistory } from '@/lib/api/cash';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtMoney, fmtTime, fmtDateTime, fmtDayLabel } from '@/lib/format';
import { apiErrorMessage } from '@/lib/apiError';

export default function CashHistory({ refreshKey, scopeParams = {} }) {
    const [period, setPeriod] = useState('day');
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        setLoadError(null);
        // Antes un fallo dejaba `{ registers: [] }`: además de la lista, los KPI
        // (turnos, ventas, diferencia) salían en cero y la pantalla afirmaba «No
        // hay turnos en este período». En un arqueo de caja eso es peor que un
        // error visible.
        listCashHistory({ period, ...scopeParams })
            .then((r) => setData(r.data))
            .catch((e) => {
                setData(null);
                setLoadError(apiErrorMessage(e, 'No se pudo cargar el historial de turnos'));
            });
    }, [period, refreshKey, scopeParams, reload]);

    const grouped = useMemo(() => {
        const map = {};
        for (const r of data?.registers || []) {
            const key = fmtDayLabel(r.opened_at);
            if (!map[key]) map[key] = [];
            map[key].push(r);
        }
        return Object.entries(map);
    }, [data]);

    return (
        <Card data-testid="caja-historial">
            <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-display text-lg font-semibold">Historial de turnos</h2>
                    <Tabs value={period} onValueChange={setPeriod}>
                        <TabsList>
                            <TabsTrigger value="day" data-testid="caja-hist-day">Hoy</TabsTrigger>
                            <TabsTrigger value="week" data-testid="caja-hist-week">Semana</TabsTrigger>
                            <TabsTrigger value="month" data-testid="caja-hist-month">Mes</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                {/* grid-cols-2 en móvil: en 3 columnas los importes quedaban en ~90 px. */}
                {data && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                            <div className="text-xs text-muted-foreground">Turnos</div>
                            <div className="font-mono font-semibold tabular-nums">{data.sessions}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Ventas cerradas</div>
                            <div className="font-mono font-semibold tabular-nums text-primary">{fmtMoney(data.total_sales)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">Diferencia</div>
                            <div className={`font-mono font-semibold tabular-nums ${Number(data.difference) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(data.difference)}</div>
                        </div>
                    </div>
                )}
                {loadError && (
                    <div className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive" data-testid="caja-historial-error">
                        {loadError}
                        <Button size="sm" variant="outline" className="ml-3 h-9" onClick={() => setReload((n) => n + 1)} data-testid="caja-historial-reintentar">
                            Reintentar
                        </Button>
                    </div>
                )}
                {!data ? (
                    <div className="text-sm text-muted-foreground">
                        {loadError ? 'No se pudo cargar el historial.' : 'Cargando historial…'}
                    </div>
                ) : grouped.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No hay turnos en este período.</div>
                ) : (
                    <div className="space-y-4">
                        {grouped.map(([day, regs]) => (
                            <div key={day}>
                                <div className="page-kicker mb-2">{day}</div>
                                <div className="divide-y border border-border rounded-sm">
                                    {regs.map((r) => (
                                        <div key={r.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm" data-testid={`caja-hist-${r.id}`}>
                                            <div>
                                                <div className="font-medium">
                                                    {fmtDateTime(r.opened_at)}
                                                    {r.closed_at ? ` → ${fmtTime(r.closed_at)}` : ' · abierta'}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {r.opened_by_name}
                                                    {r.status === 'closed' ? ` · cierre ${fmtMoney(r.closing_amount)}` : ''}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono font-semibold tabular-nums">{fmtMoney(r.total_sales || 0)}</div>
                                                {r.status === 'closed' && (
                                                    <div className={`text-xs ${Number(r.difference) < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                        Δ {fmtMoney(r.difference)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
