import React from 'react';
import OrderComposer from '@/components/OrderComposer';
import OrderTicket from '@/components/OrderTicket';
import AccountCard from './AccountCard';
import NewOrderButton from './NewOrderButton';
import PersonStrip from './PersonStrip';
import SheetHeader from './SheetHeader';
import SheetSummaryPanel from './SheetSummaryPanel';
import TableGroupPanel from './TableGroupPanel';
import TableHistory from './TableHistory';
import TableSummaryDialog from './TableSummaryDialog';
import { buildMoreActions } from './sheetActions';

/**
 * Full-view detail of the open table (replaces the old side sheet): the
 * account cards, the inline menu and ticket, the summary panel and the table
 * summary dialog. Presentational: every value comes from the sheet model and
 * every action from the container.
 */
export default function TableSheet({
    model, sheet, perms, data, actions,
}) {
    const { table: t, history, loading, accountTable, accounts, group, members, groupAccounts, order, currentAccountId, floor, canCompose, allItems, orderItems, sendState, showSend, hasAccount, personAccounts, persons, cards, summaryRows, receiptAccounts, tableDishes, tableTotal, tableConsumido, tablePagado, tablePendiente, pendingCount, draftUnits, actionOrder, actionAccountId, actionDue, closeable, billRequested } = model;
    const { composerOpen, personNameEdit, setPersonNameEdit, aliasDraft, setAliasDraft, sharedDraft, setSharedDraft, cardRenameId, setCardRenameId, cardRenameDraft, setCardRenameDraft, savingItem, sendingToKitchen, receiptOpen, setReceiptOpen, summaryOpen, setSummaryOpen, setMoveAccountId, leaveComposer, closeSheet, saveAlias, commitCardRename, editAccount, selectAccount, addProductToAccount, removeProductFromAccount, requestSend, changeItemQty, saveItemNotes, voidProduct, clearDraft, startNewAccount, moveItemToPerson, takeOrderInline, splitAccount, mergeAccounts, composeTableFor } = sheet;
    const { canTake, canServe, canCharge, canVoidItems } = perms;
    const { products, categories, branchNames, activeOrders } = data;
    const { navigate, deliver, closeAttention, requestBill, releaseTable, openCharge, openTransfer, dissolveGroup, removeGroupMember, closing } = actions;

    // "Más opciones" del prototipo: todas las acciones ocasionales en un solo
    // menú, disparado por el botón de tres puntitos de la cabecera (S13). La
    // zona de acciones queda con dos botones: "+ Nuevo pedido" y "Cobrar".
    const moreActions = buildMoreActions({
        t, order, accountTable, accounts, hasAccount, floor, actionOrder, actionAccountId, closeable, billRequested, closing, canTake, canServe, closeSheet, navigate, takeOrderInline, deliver, closeAttention, requestBill, setSummaryOpen, splitAccount, openTransfer, setMoveAccountId, mergeAccounts, releaseTable,
    });

    return (
        <>
            <section
                data-testid="mesa-sheet"
                className={`space-y-4 ${hasAccount || t.status === 'pagada' ? 'pb-28 min-[820px]:pb-0' : ''}`}
            >
                {/* Cabecera del detalle, como `detail-head`/`poshead` del
                    prototipo: ← + título grande y estado en color. */}
                <SheetHeader
                    composerOpen={composerOpen}
                    leaveComposer={leaveComposer}
                    closeSheet={closeSheet}
                    t={t}
                    loading={loading}
                    moreActions={moreActions}
                    accountTable={accountTable}
                    order={order}
                    floor={floor}
                />

                <div
                    data-testid="mesa-sheet-layout"
                    className={`grid gap-4 min-[820px]:items-start ${composerOpen ? 'min-[820px]:grid-cols-[minmax(0,1fr)_380px]' : 'min-[820px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.65fr)]'}`}
                >
                    {/* Columna de pedidos */}
                    <div className="min-w-0 space-y-3">
                        {/* Franja "Para {persona}" del prototipo: es la
                            identidad de la cuenta (nombre y Compartido se
                            editan acá; el alias viaja al enviar). */}
                        {canCompose && composerOpen && (
                            <PersonStrip
                                personNameEdit={personNameEdit}
                                aliasDraft={aliasDraft}
                                setAliasDraft={setAliasDraft}
                                setPersonNameEdit={setPersonNameEdit}
                                saveAlias={saveAlias}
                                setSharedDraft={setSharedDraft}
                                sharedDraft={sharedDraft}
                                order={order}
                                t={t}
                                canTake={canTake}
                            />
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
                                savingItem={savingItem || sendingToKitchen || loading}
                                canCompose={canCompose}
                                showKitchen={showSend}
                                sendLabel={sendState?.label}
                                onAddProduct={addProductToAccount}
                                onRemoveProduct={removeProductFromAccount}
                                onSendToKitchen={() => requestSend()}
                                showActions={!composerOpen}
                                showHeader={!composerOpen}
                                hideUnavailable
                            />
                        </div>
                        {/* Tarjetas por cuenta, como los `.order` del
                            prototipo: persona + ✎, #id · hora, píldora de
                            estado, líneas y footer con total. La cuenta
                            activa conserva su lista editable. */}
                        {!composerOpen && (hasAccount ? cards.map((account, index) => (
                            <AccountCard
                                key={account.id}
                                activeOrders={activeOrders}
                                account={account}
                                currentAccountId={currentAccountId}
                                order={order}
                                selectAccount={selectAccount}
                                cardRenameId={cardRenameId}
                                cardRenameDraft={cardRenameDraft}
                                setCardRenameDraft={setCardRenameDraft}
                                commitCardRename={commitCardRename}
                                setCardRenameId={setCardRenameId}
                                index={index}
                                canTake={canTake}
                                savingItem={savingItem}
                                sendingToKitchen={sendingToKitchen}
                                loading={loading}
                                canCompose={canCompose}
                                canVoidItems={canVoidItems}
                                voidProduct={voidProduct}
                                composeTableFor={composeTableFor}
                                editAccount={editAccount}
                                canServe={canServe}
                                deliver={deliver}
                            />
                        )) : (
                            <div className="rounded-xl border p-8 text-center space-y-3" data-testid="mesa-sheet-vacio">
                                <p className="font-display text-xl font-semibold">
                                    {t.status === 'reservada' ? 'Mesa reservada' : 'Mesa libre'}
                                </p>
                                <p className="text-sm text-muted-foreground">Aún no hay pedidos en esta mesa.</p>
                                {canCompose && (
                                    <NewOrderButton
                                        disabled={savingItem || sendingToKitchen || loading}
                                        onClick={startNewAccount}
                                        expanded={composerOpen}
                                    />
                                )}
                            </div>
                        ))}
                        {accountTable && order && (
                            <p className="text-sm font-medium" data-testid="mesa-sheet-cuenta-grupo">
                                Cuenta de Mesa {accountTable.number}
                            </p>
                        )}
                        {group && (
                            <TableGroupPanel
                                members={members}
                                groupAccounts={groupAccounts}
                                t={t}
                                canTake={canTake}
                                removeGroupMember={removeGroupMember}
                                group={group}
                                activeOrders={activeOrders}
                                closeSheet={closeSheet}
                                navigate={navigate}
                                dissolveGroup={dissolveGroup}
                            />
                        )}
                        {history && history.length > 0 && (
                            <TableHistory
                                history={history}
                                branchNames={branchNames}
                            />
                        )}
                    </div>

                    {composerOpen ? (
                        /* Inline draft ticket: sticky on desktop, in-flow on mobile.
                           Sending opens review before explicit confirmation. */
                        <div className="min-w-0 min-[820px]:sticky min-[820px]:top-4">
                            <OrderTicket
                                testIdPrefix="mesa-sheet"
                                order={order}
                                items={allItems}
                                draftOnly
                                canEdit={canCompose}
                                canVoid={canVoidItems}
                                saving={savingItem || sendingToKitchen || loading}
                                draftUnits={draftUnits}
                                sendLabel={sendState?.label}
                                showSend={showSend}
                                onChangeQty={changeItemQty}
                                onNotes={saveItemNotes}
                                onVoid={voidProduct}
                                onSend={() => requestSend()}
                                onClear={clearDraft}
                            />
                        </div>
                    ) : (
                        /* Resumen del prototipo: Pedidos / Consumido /
                           Pagado / Pendiente y la barra de acciones. */
                        <SheetSummaryPanel
                            cards={cards}
                            personAccounts={personAccounts}
                            tableConsumido={tableConsumido}
                            tablePagado={tablePagado}
                            tablePendiente={tablePendiente}
                            hasAccount={hasAccount}
                            billRequested={billRequested}
                            closeable={closeable}
                            canCompose={canCompose}
                            savingItem={savingItem}
                            sendingToKitchen={sendingToKitchen}
                            loading={loading}
                            startNewAccount={startNewAccount}
                            composerOpen={composerOpen}
                            canCharge={canCharge}
                            actionDue={actionDue}
                            accountTable={accountTable}
                            order={order}
                            openCharge={openCharge}
                            actionOrder={actionOrder}
                        />
                    )}
                </div>
            </section>

            {/* "Resumen de mesa" del prototipo es sólo Pedidos/
                Consumido/Pagado/Pendiente; el desglose por producto
                (con mover de persona) y el recibo viven acá,
                alcanzables desde ⋯ Más. */}
            <TableSummaryDialog
                summaryOpen={summaryOpen}
                setSummaryOpen={setSummaryOpen}
                setReceiptOpen={setReceiptOpen}
                summaryRows={summaryRows}
                personAccounts={personAccounts}
                tableDishes={tableDishes}
                tableTotal={tableTotal}
                persons={persons}
                canCompose={canCompose}
                moveItemToPerson={moveItemToPerson}
                receiptOpen={receiptOpen}
                t={t}
                receiptAccounts={receiptAccounts}
                pendingCount={pendingCount}
            />
        </>
    );
}
