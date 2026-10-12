import usePolling from '@/hooks/usePolling';
import { getCash } from '@/lib/api/cash';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/format';

export default function ConsolidatedCashView({ branches, userKey }) {
    const { data: registers, loading, error } = usePolling(
        () => getCash().then((r) => r.data),
        12000,
        [userKey]
    );

    return (
        <Card data-testid="caja-consolidated">
            <CardContent className="space-y-4 p-5">
                <div>
                    <h1 className="font-display text-xl font-semibold">Caja consolidada</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Vista de solo lectura de las cajas del negocio. Selecciona una sucursal para operar.</p>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las cajas consolidadas.</p>}
                {loading && !registers ? <p className="text-sm text-muted-foreground">Cargando cajas…</p>
                    : !(registers || []).length ? <p className="text-sm text-muted-foreground">No hay cajas para mostrar.</p>
                        : <div className="divide-y rounded-sm border border-border">
                            {registers.map((register) => {
                                const branch = branches.find((item) => String(item.id) === String(register.branch_id));
                                const branchName = branch?.name || register.branch_name || (register.branch_id ? 'Sucursal no disponible' : 'Registro histórico sin sucursal');
                                return (
                                    <div key={register.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" data-testid={`caja-consolidated-${register.id}`}>
                                        <div>
                                            <div className="font-medium">{branchName}</div>
                                            <div className="text-xs text-muted-foreground">{register.status === 'open' ? 'Abierta' : 'Cerrada'} · {register.opened_by_name || 'Responsable no disponible'}</div>
                                        </div>
                                        <div className="text-right text-sm">
                                            <div>Fondo inicial: <span className="font-mono">{fmtMoney(register.opening_amount)}</span></div>

                                        </div>
                                    </div>
                                );
                            })}
                        </div>}
            </CardContent>
        </Card>
    );
}
