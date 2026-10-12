import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { transferTable } from '@/lib/api/tables';
import { transferCandidates, transferProblem } from '@/lib/tableGroups';
import { apiErrorMessage } from '@/lib/apiError';

/** "Mover pedido": relocate the open visit of a table to another free table. */
export default function useVisitTransfer({
    tables, activeOrders, closeSheet, refreshAll,
}) {
    const [transferSource, setTransferSource] = useState(null);
    const [movingVisit, setMovingVisit] = useState(false);

    const transferTargets = useMemo(
        () => transferCandidates(tables || [], activeOrders, transferSource),
        [tables, activeOrders, transferSource]
    );

    const openTransfer = (t) => {
        const problem = transferProblem(t, activeOrders);
        if (problem) { toast.info(problem); return; }
        closeSheet();
        setTransferSource(t);
    };

    const moveVisit = async (target) => {
        if (!transferSource || movingVisit) return;
        setMovingVisit(true);
        try {
            const { data } = await transferTable(transferSource.id, { target_table_id: target.id });
            toast.success(`Pedido movido a Mesa ${data?.to_number ?? target.number}`);
            setTransferSource(null);
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo mover el pedido'));
            refreshAll();
        } finally {
            setMovingVisit(false);
        }
    };

    return {
        transferSource,
        setTransferSource,
        movingVisit,
        transferTargets,
        openTransfer,
        moveVisit,
    };
}
