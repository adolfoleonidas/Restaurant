import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreditCard, Smartphone, Banknote, Building2, Upload, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';

const MethodToggle = ({ label, checked, onChange, icon: Icon, testId }) => (
    <label className="flex items-center gap-3 border rounded-xl p-3 cursor-pointer hover:bg-secondary/40 transition-colors">
        <Icon className="h-5 w-5 text-primary" />
        <div className="flex-1">
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{checked ? 'Habilitado para clientes' : 'Oculto en el checkout'}</div>
        </div>
        <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </label>
);

export default function Pagos() {
    const [cfg, setCfg] = useState(null);
    const [tab, setTab] = useState('yape');

    const load = async () => { const { data } = await api.get('/payment-config'); setCfg(data); };
    useEffect(() => { load(); }, []);

    const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

    const onQrFile = (key) => (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        if (f.size > 1.8 * 1024 * 1024) { toast.error('Imagen muy pesada (max ~1.8MB)'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => set({ [key]: ev.target.result });
        reader.readAsDataURL(f);
    };

    const save = async () => {
        try { const { data } = await api.patch('/payment-config', cfg); setCfg(data); toast.success('Configuración guardada'); }
        catch (e) { toast.error(e.response?.data?.detail || 'Error'); }
    };

    if (!cfg) return <div className="text-muted-foreground">Cargando…</div>;

    return (
        <div className="space-y-5" data-testid="pagos-root">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                    <p className="page-kicker mb-1">Administración</p>
                    <h1 className="font-display text-3xl font-semibold flex items-center gap-2"><CreditCard className="h-6 w-6 text-primary" /> Métodos de pago</h1>
                    <p className="text-muted-foreground text-sm">Activá los medios que aceptás y completá los datos que ve tu cliente al pagar.</p>
                </div>
                <Button onClick={save} data-testid="pagos-save"><Save className="h-4 w-4 mr-2" />Guardar cambios</Button>
            </div>

            <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <MethodToggle label="Efectivo" icon={Banknote} checked={!!cfg.enable_efectivo} onChange={(v) => set({ enable_efectivo: v })} testId="toggle-efectivo" />
                <MethodToggle label="Yape" icon={Smartphone} checked={!!cfg.enable_yape} onChange={(v) => set({ enable_yape: v })} testId="toggle-yape" />
                <MethodToggle label="Plin" icon={Smartphone} checked={!!cfg.enable_plin} onChange={(v) => set({ enable_plin: v })} testId="toggle-plin" />
                <MethodToggle label="Transferencia bancaria" icon={Building2} checked={!!cfg.enable_transferencia} onChange={(v) => set({ enable_transferencia: v })} testId="toggle-transferencia" />
                <MethodToggle label="Tarjeta" icon={CreditCard} checked={!!cfg.enable_tarjeta} onChange={(v) => set({ enable_tarjeta: v })} testId="toggle-tarjeta" />
            </CardContent></Card>

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="yape">Yape</TabsTrigger>
                    <TabsTrigger value="plin">Plin</TabsTrigger>
                    <TabsTrigger value="transferencia">Transferencia</TabsTrigger>
                </TabsList>
                {['yape', 'plin'].map((m) => (
                    <TabsContent key={m} value={m}>
                        <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-3">
                                <div><Label>Número {m === 'yape' ? 'Yape' : 'Plin'}</Label><Input value={cfg[`${m}_number`] || ''} onChange={(e) => set({ [`${m}_number`]: e.target.value })} placeholder="999 888 777" data-testid={`pagos-${m}-numero`} /></div>
                                <div><Label>Nombre del titular</Label><Input value={cfg[`${m}_holder`] || ''} onChange={(e) => set({ [`${m}_holder`]: e.target.value })} data-testid={`pagos-${m}-titular`} /></div>
                            </div>
                            <div>
                                <Label>QR (imagen)</Label>
                                {cfg[`${m}_qr`] ? (
                                    <div className="border rounded-xl p-3 flex items-center gap-3">
                                        <img src={cfg[`${m}_qr`]} alt="QR" className="h-32 w-32 object-contain bg-white rounded" />
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs underline cursor-pointer"><input type="file" accept="image/*" className="hidden" onChange={onQrFile(`${m}_qr`)} />Reemplazar</label>
                                            <Button size="sm" variant="ghost" onClick={() => set({ [`${m}_qr`]: '' })} className="text-destructive"><Trash2 className="h-4 w-4 mr-1" />Quitar</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <label className="flex items-center justify-center border-2 border-dashed rounded-xl py-8 cursor-pointer hover:bg-secondary/40" data-testid={`pagos-${m}-qr-drop`}>
                                        <input type="file" accept="image/*" className="hidden" onChange={onQrFile(`${m}_qr`)} />
                                        <div className="text-center text-sm text-muted-foreground"><Upload className="h-6 w-6 mx-auto mb-2" />Sube la imagen del QR</div>
                                    </label>
                                )}
                            </div>
                        </CardContent></Card>
                    </TabsContent>
                ))}
                <TabsContent value="transferencia">
                    <Card><CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><Label>Banco</Label><Input value={cfg.bank_name || ''} onChange={(e) => set({ bank_name: e.target.value })} data-testid="pagos-bank-name" /></div>
                        <div><Label>Titular</Label><Input value={cfg.bank_holder || ''} onChange={(e) => set({ bank_holder: e.target.value })} /></div>
                        <div><Label>Número de cuenta</Label><Input value={cfg.bank_account || ''} onChange={(e) => set({ bank_account: e.target.value })} data-testid="pagos-bank-account" /></div>
                        <div><Label>CCI</Label><Input value={cfg.bank_cci || ''} onChange={(e) => set({ bank_cci: e.target.value })} /></div>
                        <div className="md:col-span-2"><Label>Instrucciones para el cliente</Label><Textarea value={cfg.transfer_instructions || ''} onChange={(e) => set({ transfer_instructions: e.target.value })} placeholder="Ej: envía comprobante por WhatsApp…" /></div>
                    </CardContent></Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
