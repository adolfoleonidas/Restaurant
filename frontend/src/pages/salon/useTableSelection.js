import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createTableGroup, deleteTableGroup, removeTableGroupMember } from '@/lib/api/tables';
import { selectionProblem } from '@/lib/tableGroups';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * "Unir mesas": picking tables on the floor, joining them into a group and
 * dissolving a group or one of its members.
 */
export default function useTableSelection({
    tables, activeOrders, refreshAll, closeSheet,
}) {
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState([]);
    const [joining, setJoining] = useState(false);

    const selectionIssue = selected.length >= 2 ? selectionProblem(tables || [], activeOrders, selected) : null;
    const canConfirmJoin = selected.length >= 2 && !selectionIssue;

    const toggleSelected = (t) => {
        setSelected((ids) => (ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id]));
    };

    const startSelection = () => {
        setSelected([]);
        setSelectMode(true);
    };

    // Estable entre renders: el efecto del Esc la usa como dependencia.
    const cancelSelection = useCallback(() => {
        setSelectMode(false);
        setSelected([]);
    }, []);

    const joinTables = async () => {
        if (!canConfirmJoin || joining) return;
        setJoining(true);
        try {
            const { data } = await createTableGroup({ table_ids: selected });
            const groupId = data?.id || data?.group?.id || null;
            // Unir mesas tiene inversa fiel: la misma disolución que ya usa la
            // hoja (`DELETE /table-groups/:id`). Solo se ofrece si la API
            // devolvió el grupo; sin id no se puede deshacer y no se promete.
            if (groupId) {
                toast.success('Mesas unidas', {
                    duration: 8000,
                    action: {
                        label: 'Deshacer',
                        onClick: async () => {
                            try {
                                await deleteTableGroup(groupId);
                                toast.success('Mesas separadas');
                            } catch (e) {
                                toast.error(apiErrorMessage(e, 'No se pudieron separar las mesas'));
                            } finally {
                                refreshAll();
                            }
                        },
                    },
                });
            } else {
                toast.success('Mesas unidas');
            }
            cancelSelection();
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudieron unir las mesas'));
            refreshAll();
        } finally {
            setJoining(false);
        }
    };

    const dissolveGroup = async (group) => {
        if (!group?.id) return;
        try {
            await deleteTableGroup(group.id);
            toast.success('Mesas separadas');
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudieron separar las mesas'));
            refreshAll();
        }
    };

    const removeGroupMember = async (group, member) => {
        if (!group?.id || !member?.id) return;
        try {
            await removeTableGroupMember(group.id, member.id);
            toast.success(`Mesa ${member.number} separada`);
            closeSheet();
            refreshAll();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'No se pudo separar la mesa'));
            refreshAll();
        }
    };

    // Esc sale del modo "unir mesas".
    useEffect(() => {
        if (!selectMode) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); cancelSelection(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [selectMode, cancelSelection]);

    return {
        selectMode,
        selected,
        joining,
        selectionIssue,
        canConfirmJoin,
        toggleSelected,
        startSelection,
        cancelSelection,
        joinTables,
        dissolveGroup,
        removeGroupMember,
    };
}
