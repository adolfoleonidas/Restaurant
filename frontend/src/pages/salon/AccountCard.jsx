import React from 'react';
import { Pencil } from 'lucide-react';
import { KITCHEN_TONE, PersonOrderSummary } from '@/components/OrderSummary';
import { Button } from '@/components/ui/button';
import { fmtMoney, fmtTime } from '@/lib/format';
import { itemsTotal, personLabel } from '@/lib/orderDraft';
import { usePendingActions } from '@/contexts/PendingActionsContext';
import { accountKitchenState, canComposeAccountAt, isComposingDraft } from './selectors';

export default function AccountCard({ activeOrders, account, currentAccountId, order, selectAccount, cardRenameId, cardRenameDraft, setCardRenameDraft, commitCardRename, setCardRenameId, index, canTake, savingItem, sendingToKitchen, loading, canCompose, canVoidItems, voidProduct, composeTableFor, editAccount, canServe, deliver }) {
    const pendingActions = usePendingActions();
    const detail = activeOrders[account.id] || account;
    const isActive = account.id === currentAccountId;
    const view = isActive && order ? order : detail;
    const draftAccount = isComposingDraft(view);
    const cardItems = (view.items || []).filter((i) => i.status !== 'cancelado');
    const kitchen = accountKitchenState(view.items || [], view.status);
    const cardTotal = view.total != null ? Number(view.total) : itemsTotal(view.items || []);
    const cardKey = account.order_number ?? account.id;
    // La cuenta activa conserva los testids base
    // (`mesa-sheet-items`); las demás se namespacean
    // para no duplicar localizadores.
    const cardPrefix = isActive ? 'mesa-sheet' : `mesa-sheet-pedido-${cardKey}`;
    return (
        <article
            key={account.id}
            data-testid={`mesa-sheet-pedido-${cardKey}`}
            onClick={() => { if (!isActive) selectAccount(account.id); }}
            className={`grid min-w-0 gap-2.5 rounded-xl border bg-card p-3.5 ${isActive ? 'border-primary' : 'cursor-pointer hover:border-primary/50'}`}
        >
            <header className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-1 font-extrabold">
                        {cardRenameId === account.id ? (
                            <input
                                autoFocus
                                value={cardRenameDraft}
                                onChange={(e) => setCardRenameDraft(e.target.value)}
                                onBlur={() => commitCardRename(view)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitCardRename(view);
                                    if (e.key === 'Escape') setCardRenameId(null);
                                }}
                                aria-label={`Editar nombre de ${personLabel(view, index)}`}
                                data-testid={`mesa-sheet-renombrar-input-${cardKey}`}
                                className="h-8 w-36 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                            />
                        ) : (
                            <>
                                <span className="min-w-0 truncate">
                                    {draftAccount && !view.customer_name && !view.shared
                                        ? 'Nuevo pedido' : personLabel(view, index)}
                                </span>
                                {canTake && (
                                    <button
                                        type="button"
                                        disabled={savingItem || sendingToKitchen || loading}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCardRenameId(account.id);
                                            setCardRenameDraft(String(detail.customer_name || '').trim());
                                        }}
                                        aria-label={`Editar nombre de ${personLabel(view, index)}`}
                                        data-testid={`mesa-sheet-renombrar-${cardKey}`}
                                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    <div className="text-xs text-muted-foreground">#{view.order_number} · {fmtTime(view.created_at)}</div>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-extrabold ${KITCHEN_TONE[kitchen.key]}`}>
                    {kitchen.label}
                </span>
            </header>
            {/* Tarjeta de LECTURA como el `.order` del
                mockup: la edición de borradores vive en el
                ticket del compositor. Del ítem enviado queda
                el ✕ discreto para anularlo. */}
            <PersonOrderSummary
                items={view.items || []}
                orderStatus={view.status}
                mode="detail"
                testIdPrefix={cardPrefix}
                canEdit={isActive && canCompose}
                canVoid={canVoidItems}
                saving={savingItem}
                onVoid={voidProduct}
            />
            {cardItems.length === 0 && (
                <p className="text-xs text-muted-foreground">Todavía no pidió nada.</p>
            )}
            {view.notes && (
                <p className="rounded-lg bg-[hsl(var(--warn)/0.12)] px-2 py-1.5 text-[13px] font-bold text-[hsl(var(--warn))]">
                    📝 {view.notes}
                </p>
            )}
            <footer className="flex items-center justify-between gap-2 border-t border-dashed pt-2">
                <strong className="font-mono tabular-nums">{fmtMoney(cardTotal)}</strong>
                {canCompose && canComposeAccountAt(view, composeTableFor(view)) && (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingItem || sendingToKitchen || loading}
                        onClick={(event) => { event.stopPropagation(); void editAccount(view); }}
                        data-testid="mesa-sheet-editar-pedido"
                    >
                        Editar pedido
                    </Button>
                )}
                {kitchen.key === 'ready' && canServe && (
                    <Button
                        size="sm"
                        className="h-9 bg-[hsl(var(--warn))] text-[hsl(var(--background))] hover:opacity-90"
                        onClick={(e) => { e.stopPropagation(); deliver(view.id); }}
                        disabled={pendingActions.has(`deliver:${view.id}`)}
                        aria-busy={pendingActions.has(`deliver:${view.id}`) ? 'true' : undefined}
                        data-testid={`mesa-sheet-entregar-${view.order_number}`}
                    >
                        {pendingActions.has(`deliver:${view.id}`) ? 'Entregando…' : '✓ Entregado'}
                    </Button>
                )}
            </footer>
        </article>
    );
}
