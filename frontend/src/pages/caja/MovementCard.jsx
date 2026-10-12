import { useState } from 'react';
import { addCashMovement } from '@/lib/api/cash';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fmtMoney, fmtTime } from '@/lib/format';
import { PlusCircle, MinusCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { apiErrorMessage } from '@/lib/apiError';

export default function MovementCard({ register, onAdded, runMutation }) {
    const [type, setType] = useState('ingreso');
    const [amount, setAmount] = useState('');
    const [desc, setDesc] = useState('');
    const submit = async () => {
        if (!amount || Number(amount) <= 0) { toast.error('Ingresa un monto mayor a 0'); return; }
        if (desc.trim().length < 5) { toast.error('Escribe una descripción (mínimo 5 caracteres)'); return; }
        try {
            await runMutation(() => addCashMovement({ type, amount: Number(amount), description: desc.trim() }));
            toast.success('Movimiento registrado');
            setAmount(''); setDesc('');
            onAdded && onAdded();
        } catch (e) { toast.error(apiErrorMessage(e, 'No se pudo completar la operación. Revisa tu conexión y reintenta.')); }
    };
    return (
        <Card><CardContent className="p-5">
            <h2 className="font-display text-lg font-semibold mb-3">Movimientos de caja</h2>
            <div className="grid sm:grid-cols-4 gap-2">
                <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ingreso">Ingreso</SelectItem>
                        <SelectItem value="egreso">Egreso</SelectItem>
                    </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="caja-mov-monto" />
                <Input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} className="sm:col-span-1" data-testid="caja-mov-desc" />
                <Button onClick={submit} data-testid="caja-mov-submit">{type === 'ingreso' ? <PlusCircle className="h-4 w-4 mr-1" /> : <MinusCircle className="h-4 w-4 mr-1" />} Registrar</Button>
            </div>
            {(register.movements || []).length > 0 && (
                <div className="mt-4 divide-y">
                    {register.movements.map((m) => (
                        <div key={m.id} className="py-2 flex items-center justify-between text-sm">
                            <div>
                                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${m.type === 'ingreso' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                <span className="text-muted-foreground">{fmtTime(m.created_at)}</span> · {m.description}
                            </div>
                            <span className={`font-semibold tabular-nums ${m.type === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}`}>{m.type === 'ingreso' ? '+' : '-'}{fmtMoney(m.amount)}</span>
                        </div>
                    ))}
                </div>
            )}
        </CardContent></Card>
    );
}
