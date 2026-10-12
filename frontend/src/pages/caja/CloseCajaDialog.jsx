import React, { useState } from 'react';
import { closeCash } from '@/lib/api/cash';
import { DIGITAL_METHODS } from '@/lib/paymentMethods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { fmtMoney, PAYMENT_LABELS } from '@/lib/format';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { round2 } from '@/lib/cash';
import { apiErrorMessage } from '@/lib/apiError';

export default function CloseCajaDialog({ open, onOpenChange, register, onClosed, runMutation }) {
    const [closing, setClosing] = useState('');
    const [notes, setNotes] = useState('');
    React.useEffect(() => {
        if (open) { setClosing(''); setNotes(''); }
    }, [open, register?.id]);
    if (!register) return null;
    const expected = Number(register.expected_amount || 0);
    const counted = closing === '' ? null : Number(closing);
    const diff = counted == null || Number.isNaN(counted) ? null : round2(counted - expected);
    const by = register.by_method || {};
    const digital = DIGITAL_METHODS.filter((m) => Number(by[m] || 0) > 0);
    const submit = async () => {
        if (closing === '' || Number.isNaN(Number(closing))) { toast.error('Indicá el efectivo contado'); return; }
        try {
            const { data } = await runMutation(() => closeCash({ closing_amount: Number(closing), notes }));
            const delta = Number(data.difference || 0);
            toast.success(delta === 0 ? 'Turno cerrado. El cajón cuadra.' : `Turno cerrado. Diferencia: ${fmtMoney(delta)}`);
            onClosed && onClosed();
            onOpenChange(false);
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo completar la operación. Revisá tu conexión y reintentá.')); }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md" data-testid="caja-cierre-dialog">
                <DialogHeader><DialogTitle>Cerrar turno</DialogTitle></DialogHeader>
                <div className="space-y-3">
                    <div className="rounded-xl bg-secondary/40 p-3 text-sm space-y-1" data-testid="caja-cierre-resumen">
                        <div className="flex justify-between"><span>Fondo inicial</span><span className="font-mono tabular-nums">{fmtMoney(register.opening_amount)}</span></div>
                        <div className="flex justify-between"><span>Cobros netos en efectivo</span><span className="font-mono tabular-nums">{fmtMoney(register.cash_sales)}</span></div>
                        <div className="flex justify-between"><span>Ingresos</span><span className="font-mono tabular-nums">{fmtMoney(register.income)}</span></div>
                        <div className="flex justify-between"><span>Retiros</span><span className="font-mono tabular-nums">- {fmtMoney(register.expense)}</span></div>
                        <div className="border-t pt-2 flex justify-between font-semibold"><span>Efectivo esperado</span><span className="font-mono tabular-nums" data-testid="caja-cierre-esperado">{fmtMoney(expected)}</span></div>
                    </div>
                    {digital.length > 0 && (
                        <div className="rounded-xl border border-border p-3 text-sm space-y-1">
                            <div className="text-xs text-muted-foreground">No van al cajón</div>
                            {digital.map((m) => (
                                <div key={m} className="flex justify-between"><span>{PAYMENT_LABELS[m]}</span><span className="font-mono tabular-nums">{fmtMoney(by[m])}</span></div>
                            ))}
                        </div>
                    )}
                    <div>
                        <Label>Efectivo contado (S/)</Label>
                        <Input type="number" min="0" step="0.01" value={closing} onChange={(e) => setClosing(e.target.value)} className="h-11" data-testid="caja-cierre-monto" />
                    </div>
                    {diff != null && (
                        <div className={`rounded-xl p-3 ${diff < 0 ? 'bg-destructive/10' : 'bg-primary/10'}`} data-testid="caja-cierre-diferencia">
                            <div className="text-xs text-muted-foreground">{diff < 0 ? 'Faltan' : diff > 0 ? 'Sobra' : 'Cuadra'}</div>
                            <div className="font-display text-2xl font-semibold tabular-nums">{fmtMoney(Math.abs(diff))}</div>
                        </div>
                    )}
                    <div><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={submit} data-testid="caja-cierre-submit">Cerrar turno</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
