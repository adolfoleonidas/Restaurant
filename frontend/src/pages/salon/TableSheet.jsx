import React from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { selectSheetModel } from '@/pages/salon/selectors';
import TableSheetContent from '@/pages/salon/TableSheetContent';

/**
 * Right-hand sheet with the detail of one table. The derived values come from
 * `selectSheetModel`; everything else is plain props from the Salón container.
 */
export default function TableSheet({
    activeOrders, addProductToAccount, aliasDraft, applyItemNote,
    branchNames, canClose, canServe, canTake,
    categories, changeItemQty, closeAttention, closeSheet,
    closing, composerOpen, deliver, dissolveGroup,
    flash, mergeAccounts, moveItemToPerson, navigate,
    openTable, openTransfer, products, receiptOpen,
    releaseTable, removeGroupMember, removeProductFromAccount, requestBill,
    saveAlias, saveItemNotes, savingItem, selectAccount,
    sendCurrentToKitchen, setAliasDraft, setComposerOpen, setFlash,
    setMoveAccountId, setReceiptOpen, setSharedDraft, sharedDraft,
    sheetOrder, splitAccount, startAnotherPerson, tables,
    takeOrderInline, voidProduct,
}) {
    const model = openTable
        ? selectSheetModel({ openTable, sheetOrder, tables, activeOrders, canTake, canClose })
        : null;
    return (
        <Sheet open={Boolean(openTable)} onOpenChange={(o) => { if (!o) closeSheet(); }}>
            <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" aria-describedby={undefined} data-testid="mesa-sheet">
                {model && (
                    <TableSheetContent
                        model={model}
                        activeOrders={activeOrders}
                        addProductToAccount={addProductToAccount}
                        aliasDraft={aliasDraft}
                        applyItemNote={applyItemNote}
                        branchNames={branchNames}
                        canServe={canServe}
                        canTake={canTake}
                        categories={categories}
                        changeItemQty={changeItemQty}
                        closeAttention={closeAttention}
                        closeSheet={closeSheet}
                        closing={closing}
                        composerOpen={composerOpen}
                        deliver={deliver}
                        dissolveGroup={dissolveGroup}
                        flash={flash}
                        mergeAccounts={mergeAccounts}
                        moveItemToPerson={moveItemToPerson}
                        navigate={navigate}
                        openTransfer={openTransfer}
                        products={products}
                        receiptOpen={receiptOpen}
                        releaseTable={releaseTable}
                        removeGroupMember={removeGroupMember}
                        removeProductFromAccount={removeProductFromAccount}
                        requestBill={requestBill}
                        saveAlias={saveAlias}
                        saveItemNotes={saveItemNotes}
                        savingItem={savingItem}
                        selectAccount={selectAccount}
                        sendCurrentToKitchen={sendCurrentToKitchen}
                        setAliasDraft={setAliasDraft}
                        setComposerOpen={setComposerOpen}
                        setFlash={setFlash}
                        setMoveAccountId={setMoveAccountId}
                        setReceiptOpen={setReceiptOpen}
                        setSharedDraft={setSharedDraft}
                        sharedDraft={sharedDraft}
                        splitAccount={splitAccount}
                        startAnotherPerson={startAnotherPerson}
                        takeOrderInline={takeOrderInline}
                        voidProduct={voidProduct}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}
