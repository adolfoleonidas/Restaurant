import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    addTableGroupMember, createTableGroup, deleteTableGroup, removeTableGroupMember,
} from '@/lib/api/tables';
import {
    anchorCandidates, groupMembers, joinOperation, pickProblem, resolveAnchor,
    seatsOf, selectionGuidance,
} from '@/lib/tableGroups';
import { countOf } from '@/lib/format';
import { apiErrorMessage } from '@/lib/apiError';

/**
 * "Unir mesas": picking tables on the floor, joining them into a group, growing a
 * group that is already joined, and dissolving one.
 *
 * The selection is a set of picks — tables, plus at most one joined group — and
 * `joinOperation` decides which endpoint that means (see `lib/tableGroups.js`).
 * The mozo only ever answers "which tables go together".
 */
export default function useTableSelection({
    tables, activeOrders, refreshAll, closeSheet,
}) {
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState([]);
    const [pickedGroupIds, setPickedGroupIds] = useState([]);
    const [chosenAnchorId, setChosenAnchorId] = useState(null);
    const [joining, setJoining] = useState(false);
    // El grupo que espera el "Separar" confirmado desde el piso, y el que ya
    // tiene la petición en vuelo.
    const [separateGroup, setSeparateGroup] = useState(null);
    const [separating, setSeparating] = useState(null);

    const operation = joinOperation({
        tables, activeOrders, pickedIds: selected, pickedGroupIds,
    });
    const selectionIssue = operation.issue;
    const canConfirmJoin = operation.canConfirm;
    const pickedGroup = operation.group;

    // Qué mesas van a quedar juntas: las del grupo elegido más las sueltas.
    const pickedTables = (tables || []).filter((t) => selected.includes(t.id));
    const planned = [...(pickedGroup ? groupMembers(pickedGroup, tables) : []), ...pickedTables]
        .sort((a, b) => Number(a.number) - Number(b.number));
    const seats = seatsOf(planned);
    const guidance = selectionGuidance({ operation, pickedIds: selected, tables });

    // La mesa principal solo se elige al formar un grupo; al ampliar uno, la
    // decide la API con las cuentas que ya existen.
    const candidates = operation.kind === 'create'
        ? anchorCandidates(tables || [], activeOrders, selected)
        : [];
    const anchorId = resolveAnchor(selected, candidates, chosenAnchorId);

    /**
     * Por qué cada mesa no se puede elegir ahora mismo, para que la tarjeta lo
     * diga en su sitio en vez de callarse y dejar el motivo solo en la barra.
     */
    const pickIssues = {};
    if (selectMode) {
        for (const table of tables || []) {
            const issue = pickProblem(table, {
                tables, activeOrders, pickedIds: selected, pickedGroup,
            });
            if (issue) pickIssues[table.id] = issue;
        }
    }

    // Elegir una mesa unida elige su grupo entero: el mozo señala la fiesta, no
    // una silla. Volver a tocarla la quita.
    const toggleSelected = (t) => {
        if (t?.group?.id) {
            setPickedGroupIds((ids) => (ids.includes(t.group.id) ? ids.filter((id) => id !== t.group.id) : [...ids, t.group.id]));
            return;
        }
        setSelected((ids) => (ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id]));
    };

    /** Quita una ficha de la barra: la mesa o el grupo, según cuál sea. */
    const unpick = (id) => {
        setSelected((ids) => ids.filter((entry) => entry !== id));
        setPickedGroupIds((ids) => ids.filter((entry) => entry !== id));
    };

    const startSelection = () => {
        setSelected([]);
        setPickedGroupIds([]);
        setChosenAnchorId(null);
        setSelectMode(true);
    };

    // Estable entre renders: el efecto del Esc la usa como dependencia.
    const cancelSelection = useCallback(() => {
        setSelectMode(false);
        setSelected([]);
        setPickedGroupIds([]);
        setChosenAnchorId(null);
    }, []);

    /**
     * Un grupo nuevo con las mesas elegidas. La inversa fiel es la misma
     * disolución que ya usa la hoja (`DELETE /table-groups/:id`), y solo se
     * promete si la API devolvió el grupo: sin id no hay nada que deshacer.
     */
    async function createGroup(ids) {
        // La mesa principal solo viaja cuando el mozo eligió otra: sin ella el
        // servidor aplica la misma regla que la barra ya muestra.
        const payload = { table_ids: ids };
        if (anchorId && anchorId !== candidates[0]?.id) payload.anchor_table_id = anchorId;
        const { data } = await createTableGroup(payload);
        const groupId = data?.id || data?.group?.id || null;
        if (!groupId) {
            toast.success('Mesas unidas');
            return;
        }
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
    }

    /**
     * Una mesa más para un grupo ya unido, que antes obligaba a separarlo y
     * volver a unir todo. La API suma de una en una (revalidando la unión
     * entera en cada paso), así que se encadenan y el deshacer devuelve cada una
     * al piso.
     */
    async function growGroup(group, ids) {
        for (const id of ids) await addTableGroupMember(group.id, id);
        const added = [...ids];
        // El aviso nombra las mesas que se sumaron: "1 Mesa sumada" no dice al
        // mozo cuál acaba de entrar al grupo.
        const numbers = (tables || [])
            .filter((t) => added.includes(t.id))
            .map((t) => t.number)
            .sort((a, b) => Number(a) - Number(b));
        const label = numbers.length === 1
            ? `Mesa ${numbers[0]} sumada al grupo`
            : `Mesas ${numbers.join(' + ')} sumadas al grupo`;
        toast.success(numbers.length ? label : `${countOf(added.length, 'Mesa', 'Mesas')} al grupo`, {
            duration: 8000,
            action: {
                label: 'Deshacer',
                onClick: async () => {
                    try {
                        for (const id of added.reverse()) await removeTableGroupMember(group.id, id);
                        toast.success('Mesas separadas');
                    } catch (e) {
                        toast.error(apiErrorMessage(e, 'No se pudieron separar las mesas'));
                    } finally {
                        refreshAll();
                    }
                },
            },
        });
    }

    const joinTables = async () => {
        if (!canConfirmJoin || joining) return;
        setJoining(true);
        try {
            if (operation.kind === 'extend' && pickedGroup) await growGroup(pickedGroup, selected);
            else await createGroup(selected);
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

    // Separar desde el piso: disolver toca a todas las mesas del grupo, así que
    // la tarjeta lo pide y aquí se confirma.
    const confirmSeparateGroup = async () => {
        const group = separateGroup;
        setSeparateGroup(null);
        if (!group) return;
        setSeparating(group.id);
        try {
            await dissolveGroup(group);
        } finally {
            setSeparating(null);
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
        pickedGroupIds,
        pickedGroup,
        joining,
        selectionIssue,
        canConfirmJoin,
        guidance,
        seats,
        operation,
        anchorId,
        anchorCandidates: candidates,
        chooseAnchor: setChosenAnchorId,
        planned,
        pickIssues,
        toggleSelected,
        unpick,
        startSelection,
        cancelSelection,
        joinTables,
        dissolveGroup,
        removeGroupMember,
        separateGroup,
        separating,
        askSeparateGroup: setSeparateGroup,
        cancelSeparateGroup: () => setSeparateGroup(null),
        confirmSeparateGroup,
    };
}
