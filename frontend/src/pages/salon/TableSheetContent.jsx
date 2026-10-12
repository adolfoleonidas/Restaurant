import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetTitle } from '@/components/ui/sheet';
import { fmtMoney, fmtElapsed } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/constants/status';
import { isComposingDraft } from '@/pages/salon/selectors';
import OrderComposer from '@/components/OrderComposer';
import PersonChips from '@/components/PersonChips';
import { PersonOrderSummary, TableReceipt, TableSummary } from '@/components/OrderSummary';
import { Users } from 'lucide-react';
import AttentionReference from '@/components/AttentionReference';
import { FLOOR_STYLE } from '@/lib/floorStyle';
import TableSheetFooter from '@/pages/salon/TableSheetFooter';
import TableHistory from '@/pages/salon/TableHistory';
import TableGroupPanel from '@/pages/salon/TableGroupPanel';

/**
 * Body of the table sheet: header, people, order lines and the action footer.
 */
export default function TableSheetContent({
    activeOrders, addProductToAccount, aliasDraft, applyItemNote,
    branchNames, canServe, canTake, categories,
    changeItemQty, closeAttention, closeSheet, closing,
    composerOpen, deliver, dissolveGroup, flash,
    mergeAccounts, model, moveItemToPerson, navigate,
    openTransfer, products, receiptOpen, releaseTable,
    removeGroupMember, removeProductFromAccount, requestBill, saveAlias,
    saveItemNotes, savingItem, selectAccount, sendCurrentToKitchen,
    setAliasDraft, setComposerOpen, setFlash, setMoveAccountId,
    setReceiptOpen, setSharedDraft, sharedDraft, splitAccount,
    startAnotherPerson, takeOrderInline, voidProduct,
}) {
    const {
        accountTable, accounts, actionAccountId, actionOrder,
        allItems, billRequested, canCompose, closeable,
        currentAccountId, floor, group, groupAccounts,
        hasAccount, history, loading, members,
        order, orderItems, pendingCount, personAccounts,
        persons, receiptAccounts, sendState, showSend,
        summaryRows, table: t, tableDishes, tableTotal,
    } = model;
    const s = FLOOR_STYLE[floor.key];
    return (
        <>
            {/* Título para lectores de pantalla: Radix lo exige en el diálogo. */}
            <SheetTitle className="sr-only">Mesa {t.number}</SheetTitle>
            <div className="p-5 border-b" style={{ background: s.bg }}>
                <p className="page-kicker" style={{ color: s.fg }}>Mesa {t.number} · {t.area}</p>
                <div className="flex items-center gap-2 mt-1">
                    <span className="h-3 w-3 rounded-full" style={{ background: s.dot }} />
                    <h2 className="font-display text-2xl font-semibold" style={{ color: s.fg }}>{s.label}</h2>
                </div>
                <div className="flex items-center gap-1 text-xs mt-1" style={{ color: s.fg, opacity: 0.8 }}>
                    <Users className="h-3.5 w-3.5" /> Capacidad {t.capacity} personas
                </div>
            </div>
            {/* "+ Pedido" arriba, donde el mozo ya está mirando: abre la
                carta. La acción principal de cada momento (Enviar,
                Entregar, Cuenta) vive abajo, en el pulgar. */}
            {canCompose && (
                <div className="flex items-center justify-end gap-2 border-b px-5 py-2">
                    <Button
                        variant={composerOpen ? 'outline' : 'default'}
                        className="h-11"
                        onClick={() => setComposerOpen((open) => !open)}
                        aria-expanded={composerOpen}
                        data-testid="mesa-sheet-nuevo-pedido"
                    >
                        {composerOpen ? 'Ocultar carta' : '+ Pedido'}
                    </Button>
                </div>
            )}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {t.active_order && loading && <div className="text-sm text-muted-foreground">Cargando pedido…</div>}
                {/* El resumen va arriba y plegado: el mozo lo lee de
                    reojo sin que le empuje la carta hacia abajo. */}
                {/* El resumen sólo aparece cuando hay más de una cuenta:
                    ahí es donde sirve (organizar personas y ver el recibo).
                    Con una sola repetiría lo que ya dicen la lista y el pie,
                    y el modal tiene que ser simple. */}
                {personAccounts.length > 1 && (
                <TableSummary
                    rows={summaryRows}
                    accounts={personAccounts.length}
                    dishes={tableDishes}
                    total={tableTotal}
                    people={persons}
                    canEdit={canCompose && persons.length > 1}
                    onMoveItem={moveItemToPerson}
                    onOpenReceipt={() => setReceiptOpen(true)}
                />
                )}
                {receiptOpen && (
                    <TableReceipt
                        table={t}
                        rows={summaryRows}
                        accounts={receiptAccounts}
                        total={tableTotal}
                        pending={pendingCount}
                    />
                )}
                {flash && (
                    <p
                        className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary"
                        role="status"
                        data-testid="mesa-sheet-flash"
                    >
                        {flash}
                    </p>
                )}
                {(canCompose || (accounts && accounts.length > 0)) && (
                    <PersonChips
                        people={persons}
                        activeId={currentAccountId}
                        onSelect={(id) => { setReceiptOpen(false); setFlash(null); selectAccount(id); }}
                    />
                )}
                {canCompose && (
                    <div className="space-y-1" data-testid="mesa-sheet-alias-row">
                        {/* Sin botón de guardar: el alias se escribe y viaja
                            con la comanda cuando el mozo envía el pedido. */}
                        <div className="flex items-center gap-1.5">
                            <Input
                                placeholder="Alias (opcional)"
                                value={aliasDraft}
                                onChange={(e) => setAliasDraft(e.target.value)}
                                onBlur={() => { if (order) saveAlias(); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(); }}
                                data-testid="mesa-sheet-alias"
                            />
                            {/* La fuente, la jarra, la entrada para compartir:
                                es de la mesa, no de una persona. */}
                            <button
                                type="button"
                                onClick={() => setSharedDraft((cur) => !cur)}
                                aria-pressed={sharedDraft}
                                title="Lo que pide la mesa entera"
                                data-testid="mesa-sheet-compartido"
                                className={`flex h-11 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                                    sharedDraft
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border text-muted-foreground hover:border-primary'
                                }`}
                            >
                                🍽️ Compartido
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid="mesa-sheet-alias-hint">
                            {persons.length > 0
                                ? 'Nuevo pedido: escribí un alias o tocá una persona para sumarle lo suyo.'
                                : 'El alias es opcional: sin él queda como Persona 1.'}
                        </p>
                        {/* Con una persona ya cargada a la vista, este es el
                            camino de vuelta al pedido de la siguiente. */}
                        {order && !isComposingDraft(order) && (
                            <button
                                type="button"
                                onClick={startAnotherPerson}
                                data-testid="mesa-sheet-otra-persona"
                                className="min-h-9 w-full rounded-lg border border-dashed border-border px-3 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
                            >
                                ＋ Pedido de otra persona
                            </button>
                        )}
                    </div>
                )}
                {/* La carta se queda montada al plegarse: así conserva
                    la búsqueda y la categoría elegidas cuando el mozo
                    la vuelve a abrir para el pedido siguiente. */}
                <div hidden={!composerOpen}>
                    <OrderComposer
                        order={order}
                        items={orderItems}
                        products={products}
                        categories={categories}
                        savingItem={savingItem}
                        canCompose={canCompose}
                        showKitchen={showSend}
                        sendLabel={sendState?.label}
                        onAddProduct={addProductToAccount}
                        onRemoveProduct={removeProductFromAccount}
                        onSendToKitchen={sendCurrentToKitchen}
                    />
                </div>
                {order && (
                    <>
                        <div className="text-sm text-muted-foreground space-y-1">
                            <div>Pedido #{order.order_number} · {order.source === 'public' ? 'Carta web' : 'Salón'}</div>
                            <AttentionReference order={order} branchNames={branchNames} />
                            {order.customer_name && <div>Cliente: <span className="text-foreground">{order.customer_name}</span></div>}
                            <div>Hace {fmtElapsed(order.created_at)} · {ORDER_STATUS_LABELS[order.status] || order.status}</div>
                        </div>
                        <p className="text-xs font-medium text-muted-foreground" data-testid="mesa-sheet-items-titulo">
                            {order.status === 'nuevo' ? 'Por enviar' : 'Lo de esta persona'}
                        </p>
                        <PersonOrderSummary
                            items={allItems}
                            orderStatus={order.status}
                            canEdit={canCompose}
                            saving={savingItem}
                            onChangeQty={changeItemQty}
                            onNotes={saveItemNotes}
                            onApplyNote={applyItemNote}
                            onVoid={voidProduct}
                        />
                        <div className="flex justify-between font-display text-lg font-bold">
                            <span>Total</span>
                            <span className="font-mono tabular-nums">{fmtMoney(order.total)}</span>
                        </div>
                    </>
                )}
                {!t.active_order && !canCompose && <p className="text-sm text-muted-foreground">Sin pedido activo en esta mesa.</p>}
                {accountTable && order && (
                    <p className="text-sm font-medium" data-testid="mesa-sheet-cuenta-grupo">
                        Cuenta de Mesa {accountTable.number}
                    </p>
                )}
                {t.active_attention_id && order && (
                    <p className="text-sm text-muted-foreground">La visita sigue abierta. Finalizala cuando el cobro y la entrega estén completos.</p>
                )}
                {group && (
                <TableGroupPanel
                    activeOrders={activeOrders}
                    canTake={canTake}
                    closeSheet={closeSheet}
                    dissolveGroup={dissolveGroup}
                    group={group}
                    groupAccounts={groupAccounts}
                    members={members}
                    navigate={navigate}
                    removeGroupMember={removeGroupMember}
                    t={t}
                />
                )}
                {history && history.length > 0 && (
                <TableHistory
                    branchNames={branchNames}
                    history={history}
                    order={order}
                />
                )}
            </div>
            <TableSheetFooter
                accountTable={accountTable}
                accounts={accounts}
                actionAccountId={actionAccountId}
                actionOrder={actionOrder}
                billRequested={billRequested}
                canServe={canServe}
                canTake={canTake}
                closeAttention={closeAttention}
                closeSheet={closeSheet}
                closeable={closeable}
                closing={closing}
                deliver={deliver}
                floor={floor}
                group={group}
                hasAccount={hasAccount}
                mergeAccounts={mergeAccounts}
                navigate={navigate}
                openTransfer={openTransfer}
                order={order}
                releaseTable={releaseTable}
                requestBill={requestBill}
                setMoveAccountId={setMoveAccountId}
                splitAccount={splitAccount}
                t={t}
                takeOrderInline={takeOrderInline}
            />
        </>
    );
}
