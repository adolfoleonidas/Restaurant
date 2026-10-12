import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/format';

/**
 * KPIs del día (prototipo `cashView`).
 *
 * Son de lectura: ventas y cobros salen de los pagos de hoy (la misma fuente
 * que el historial de pagos) y "Por cobrar" de las cuentas activas que la
 * página ya tiene cargadas. No disparan ninguna operación.
 */
export default function CajaKpis({ ventas, cobros, porCobrar }) {
    const rows = [
        { key: 'ventas', label: 'Ventas de hoy', value: fmtMoney(ventas), testId: 'caja-kpi-ventas' },
        { key: 'cobros', label: 'Cuentas cobradas', value: String(cobros), testId: 'caja-kpi-cobros' },
        { key: 'promedio', label: 'Ticket promedio', value: fmtMoney(cobros > 0 ? ventas / cobros : 0), testId: 'caja-kpi-promedio' },
        { key: 'por-cobrar', label: 'Por cobrar', value: fmtMoney(porCobrar), testId: 'caja-kpi-por-cobrar' },
    ];
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="caja-kpis">
            {rows.map((row) => (
                <Card key={row.key}>
                    <CardContent className="p-3">
                        <div className="text-xs text-muted-foreground">{row.label}</div>
                        <div className="font-display text-xl font-semibold tabular-nums" data-testid={row.testId}>{row.value}</div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
