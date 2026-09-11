import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import usePolling from '@/hooks/usePolling';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useNotify } from '@/contexts/NotifyContext';

export default function Disponibilidad() {
    const { generation } = useNotify();
    const [q, setQ] = useState('');
    const [pending, setPending] = useState(null);
    const { data: products, refetch } = usePolling(() => api.get('/products').then((r) => r.data), 20000, [generation]);

    const list = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return (products || []).filter((p) => !p.is_combo && (!needle || p.name.toLowerCase().includes(needle)));
    }, [products, q]);

    const toggle = async (p) => {
        try {
            const { data } = await api.post(`/products/${p.id}/availability`, { is_available: !p.is_available });
            if (!data.product.is_available) {
                setPending({ name: data.product.name, orders: data.pending_orders || [] });
                toast.success(`${data.product.name} agotado. Los pedidos ya aceptados siguen.`);
            } else {
                setPending(null);
                toast.success(`${data.product.name} vuelve a la carta`);
            }
            await refetch();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo actualizar');
        }
    };

    return (
        <div className="space-y-4" data-testid="disponibilidad-root">
            <div>
                <p className="page-kicker mb-1">Durante el servicio</p>
                <h1 className="font-display italic text-3xl font-semibold">Agotar o habilitar</h1>
                <p className="text-sm text-muted-foreground">No hace falta editar precio ni foto. Los pedidos ya tomados no se cancelan solos.</p>
            </div>
            <Input className="h-12" placeholder="Buscar plato…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="disp-buscar" />
            {pending && (
                <Card>
                    <CardContent className="p-4 text-sm space-y-2">
                        <div className="font-medium">{pending.name} — Agotado</div>
                        <div>Salón: actualizado. Carta web: el menú público deja de ofrecer el plato.</div>
                        {(pending.orders || []).length > 0 && (
                            <div>
                                <div className="text-muted-foreground mb-1">Consumos pendientes a revisar:</div>
                                {pending.orders.map((o) => (
                                    <Link key={o.id} to={`/pedidos/${o.id}`} className="block underline">Pedido #{o.order_number} · {o.quantity} u.</Link>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardContent className="p-0 divide-y">
                    {list.map((p) => (
                        <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3" data-testid={`disp-${p.id}`}>
                            <div>
                                <div className="font-medium">{p.name}</div>
                                <div className="text-xs text-muted-foreground">{p.is_available ? 'Disponible' : 'Agotado'}</div>
                            </div>
                            <Button variant={p.is_available ? 'outline' : 'default'} className="h-10" onClick={() => toggle(p)}>
                                {p.is_available ? 'Marcar agotado' : 'Volver a habilitar'}
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
