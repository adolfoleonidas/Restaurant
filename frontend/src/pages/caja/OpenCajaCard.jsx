import { useState } from 'react';
import { openCash } from '@/lib/api/cash';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LockOpen } from 'lucide-react';
import { toast } from 'sonner';

export default function OpenCajaCard({ onOpened, branchId, canOpen = true, runMutation }) {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const open = async () => {
        if (!amount) { toast.error('Indica monto inicial'); return; }
        setLoading(true);
        try {
            await runMutation(() => openCash({
                opening_amount: Number(amount), notes,
                ...(branchId ? { branch_id: branchId } : {}),
            }));
            toast.success('Caja abierta');
            onOpened && onOpened();
        } catch (e) { toast.error(e.response?.data?.detail || 'No se pudo completar la operación. Revisá tu conexión y reintentá.'); }
        finally { setLoading(false); }
    };
    return (
        <Card><CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><LockOpen className="h-5 w-5 text-primary" /><h2 className="font-display text-xl font-semibold">Apertura de caja</h2></div>
            <p className="text-sm text-muted-foreground mb-3">Registra el monto inicial en efectivo en la caja para empezar el turno.</p>
            <div className="grid sm:grid-cols-2 gap-3">
                <div><Label>Monto inicial (S/)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" data-testid="caja-apertura-monto" /></div>
                <div><Label>Notas (opcional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" /></div>
            </div>
            <Button onClick={open} disabled={loading || !canOpen} className="mt-4 h-11" data-testid="caja-apertura-submit"><LockOpen className="h-4 w-4 mr-2" /> Abrir caja</Button>
        </CardContent></Card>
    );
}
