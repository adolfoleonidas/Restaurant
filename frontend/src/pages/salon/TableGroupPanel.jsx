import React from 'react';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/format';
import { Unlink } from 'lucide-react';

/**
 * The joined-tables panel of the sheet: members, their accounts and the separate action.
 */
export default function TableGroupPanel({
    activeOrders, canTake, closeSheet, dissolveGroup,
    group, groupAccounts, members, navigate,
    removeGroupMember, t,
}) {
    return (
        <div className="rounded-xl border p-3 space-y-2" data-testid="mesa-sheet-grupo">
            <div className="text-xs font-medium text-muted-foreground">Mesas unidas</div>
            <div className="flex flex-wrap gap-1.5">
                {members.map((member) => (
                    <span
                        key={member.id}
                        data-testid={`mesa-sheet-grupo-miembro-${member.number}`}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ background: '#F3F0FF', borderColor: '#D9D2F0', color: '#3B2A66' }}
                    >
                        Mesa {member.number}
                        {groupAccounts.some((owner) => owner.id === member.id) && <span className="text-xs text-muted-foreground">· cuenta</span>}
                        {member.id !== t.id && canTake && (
                            <button
                                type="button"
                                onClick={() => removeGroupMember(group, member)}
                                aria-label={`Separar Mesa ${member.number}`}
                                data-testid={`mesa-sheet-quitar-grupo-${member.number}`}
                                className="ml-0.5 grid min-h-touch min-w-touch place-items-center rounded-full hover:bg-black/10"
                            >
                                <Unlink className="h-3 w-3" />
                            </button>
                        )}
                    </span>
                ))}
            </div>
            {groupAccounts.length > 0 && (
                <div className="space-y-1" data-testid="mesa-sheet-grupo-cuentas">
                    {groupAccounts.map((owner) => {
                        const ownerOrder = activeOrders[owner.id] || owner.active_order || null;
                        return (
                            <button
                                key={owner.id}
                                type="button"
                                onClick={() => { closeSheet(); navigate(`/pedidos/${ownerOrder.id}`); }}
                                data-testid={`mesa-sheet-grupo-cuenta-${owner.number}`}
                                className="w-full rounded-lg border border-border px-2 py-1.5 text-left text-xs hover:bg-secondary"
                            >
                                <span className="font-medium">Mesa {owner.number}</span>
                                {ownerOrder?.order_number ? ` · #${ownerOrder.order_number}` : ''}
                                {ownerOrder?.total != null ? ` · ${fmtMoney(ownerOrder.total)}` : ''}
                                {owner.id === t.id ? ' · esta mesa' : ''}
                                <span className="float-right underline">Abrir</span>
                            </button>
                        );
                    })}
                </div>
            )}
            <p className="text-xs text-muted-foreground" data-testid="mesa-sheet-grupo-resumen">
                {groupAccounts.length === 0
                    ? 'Todavía no hay una cuenta abierta en el grupo: cada mesa puede pedir la suya.'
                    : groupAccounts.length === 1
                        ? `Cada mesa conserva su propia cuenta; por ahora hay una: la de Mesa ${groupAccounts[0].number}.`
                        : `Cada mesa conserva su propia cuenta: hay ${groupAccounts.length} cuentas separadas en el grupo.`}
            </p>
            <Button
                variant="outline"
                className="w-full"
                onClick={() => dissolveGroup(group)}
                disabled={!canTake}
                data-testid="mesa-sheet-separar-grupo"
            >
                <Unlink className="h-4 w-4 mr-1" /> Separar mesas
            </Button>
        </div>
    );
}
