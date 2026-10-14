import { Link2, MoveRight } from 'lucide-react';
import { canRequestBill } from '@/lib/attentionClose';

/**
 * "Más opciones" of the table sheet: every occasional action in the ⋯ menu of
 * the header (S13). The bar below keeps the two day-to-day actions.
 */
export function buildMoreActions({
    t, order, accountTable, accounts, hasAccount, floor, actionOrder, actionAccountId,
    closeable, billRequested, closing, canTake, canServe, pending = new Set(),
    closeSheet, navigate, takeOrderInline, deliver, closeAttention, requestBill,
    setSummaryOpen, splitAccount, openTransfer, setMoveAccountId, mergeAccounts, releaseTable,
}) {
    return accountTable && order
        ? [{
            key: 'ver-pedido-grupo',
            label: `Ver pedido de Mesa ${accountTable.number}`,
            testId: 'mesa-sheet-ver-pedido-grupo',
            onSelect: () => { closeSheet(); navigate(`/pedidos/${order.id}`); },
        }, ...(canTake ? [{
            key: 'pedir-grupo',
            label: `Pedir para Mesa ${t.number} (cuenta aparte)`,
            testId: 'mesa-sheet-pedir-grupo',
            onSelect: () => takeOrderInline(t),
        }] : [])]
        : hasAccount ? [
            {
                key: 'ver-pedido',
                label: floor.key === 'listo' ? 'Ver pedido' : 'Abrir pedido',
                testId: 'mesa-sheet-ver-pedido',
                disabled: !actionAccountId,
                onSelect: () => { closeSheet(); navigate(`/pedidos/${actionAccountId}`); },
            },
            // S13: lo que antes vivía en la barra (entregar,
            // cerrar, solicitar cuenta) ahora es una opción del
            // menú; mismos testids para las suites.
            ...(floor.key === 'listo' && canServe ? [{
                key: 'entregar',
                label: pending.has(`deliver:${actionAccountId}`) ? 'Entregando…' : 'Entregar',
                disabled: pending.has(`deliver:${actionAccountId}`),
                testId: 'mesa-sheet-entregar',
                onSelect: () => deliver(actionAccountId),
            }] : []),
            ...(closeable ? [{
                key: 'cerrar',
                label: closing === actionOrder?.id ? 'Cerrando…' : 'Finalizar mesa',
                testId: `servicio-cerrar-sheet-${t.number}`,
                disabled: closing === actionOrder?.id,
                onSelect: () => closeAttention(actionOrder),
            }] : []),
            ...(!closeable && canTake && canRequestBill(actionOrder, { billRequested }) ? [{
                key: 'solicitar-cuenta',
                label: pending.has(`bill:${actionOrder?.id}`) ? 'Solicitando…' : 'Solicitar cuenta',
                disabled: pending.has(`bill:${actionOrder?.id}`),
                testId: 'mesa-sheet-solicitar-cuenta',
                onSelect: () => requestBill(actionOrder),
            }] : []),
            {
                key: 'resumen-recibo',
                label: 'Resumen de mesa / Recibo',
                testId: 'mesa-sheet-ver-resumen',
                onSelect: () => setSummaryOpen(true),
            },
            ...(canTake && actionOrder && (actionOrder.items || []).filter((i) => i.status !== 'cancelado').length >= 2
                ? [{ group: 'Dividir la cuenta' }, ...[2, 3, 4].map((n) => ({
                    key: `dividir-${n}`,
                    label: `En ${n} cuentas`,
                    testId: `mesa-sheet-dividir-${n}`,
                    onSelect: () => splitAccount(n),
                }))]
                : []),
            ...(canTake ? [{
                key: 'mover-pedido',
                label: 'Mover pedido a otra mesa',
                icon: MoveRight,
                testId: 'mesa-sheet-mover-pedido',
                onSelect: () => openTransfer(t),
            }] : []),
            ...(accounts.length > 1 && canTake ? [
                {
                    key: 'mover-cuenta',
                    label: 'Mover esta cuenta a otra mesa',
                    icon: MoveRight,
                    testId: 'mesa-sheet-mover-cuenta',
                    onSelect: () => setMoveAccountId(actionAccountId),
                },
                {
                    key: 'fusionar-cuentas',
                    label: 'Fusionar cuentas',
                    icon: Link2,
                    testId: 'mesa-sheet-fusionar-cuentas',
                    onSelect: mergeAccounts,
                },
            ] : []),
        ] : t.status === 'pagada' ? [{
            // La mesa ya está pagada: liberarla es la única
            // acción y vive en ⋯, no en la barra (S13).
            key: 'liberar',
            label: pending.has(`release:${t.id}`) ? 'Liberando…' : 'Liberar mesa',
            testId: 'mesa-sheet-liberar',
            disabled: !canTake || pending.has(`release:${t.id}`),
            onSelect: () => releaseTable(t),
        }] : [];
}
