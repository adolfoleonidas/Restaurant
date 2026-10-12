import React from 'react';
import AttentionReference from '@/components/AttentionReference';

export default function PickupSections({ pickupProjection, branchNames, navigate }) {
    return (
        <>
            {/* Pickups (takeout) */}
            {pickupProjection.active.length > 0 && (
                <section className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-recojos-activos">
                    <h2 className="font-semibold">Recojos activos · {pickupProjection.active.length}</h2>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.active.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">{order.status === 'listo' ? 'Listo para recojo' : 'En preparación'}</p>
                                </div>
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
                            </div>
                        ))}
                    </div>
                </section>
            )}
            {pickupProjection.prior.length > 0 && (
                <details className="rounded-md border border-border bg-card/50 p-3" data-testid="servicio-dias-anteriores">
                    <summary className="cursor-pointer font-semibold">
                        Días anteriores · {pickupProjection.prior.length} recojo(s) listos
                    </summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pickupProjection.prior.map((order) => (
                            <div key={order.id} className="flex items-center justify-between gap-3 rounded-sm border border-border p-3" data-testid={`servicio-recojo-anterior-${order.id}`}>
                                <div>
                                    <p className="font-medium">{order.order_number ? `Pedido #${order.order_number}` : 'Pedido'}</p>
                                    <AttentionReference order={order} branchNames={branchNames} />
                                    <p className="text-sm text-muted-foreground">Listo para recojo</p>
                                </div>
                                <a
                                    className="shrink-0 text-sm underline"
                                    href={`/pedidos/${order.id}`}
                                    onClick={(e) => { e.preventDefault(); navigate(`/pedidos/${order.id}`); }}
                                >
                                    Ver pedido
                                </a>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </>
    );
}
