import { useState, useMemo, useEffect, useCallback } from 'react';
import { listBranches } from '@/lib/api/branches';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIONS, can } from '@/lib/permissions';
import CajaWorkspace from '@/pages/caja/CajaWorkspace';
import ConsolidatedCashView from '@/pages/caja/ConsolidatedCashView';

export default function Caja() {
    const { user } = useAuth();
    const isOwner = can(user, ACTIONS.OWNER);
    const userKey = user?.id || user?.email || user?.role || 'signed-in';
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [branchesError, setBranchesError] = useState(false);
    const [context, setContext] = useState('all');
    const [mutationsInFlight, setMutationsInFlight] = useState(0);
    const [collectionOpen, setCollectionOpen] = useState(false);

    useEffect(() => {
        setContext('all');
        setCollectionOpen(false);
        if (!isOwner) {
            setBranches([]);
            setBranchesLoading(false);
            setBranchesError(false);
            return undefined;
        }
        let active = true;
        setBranchesLoading(true);
        setBranchesError(false);
        listBranches().then(({ data }) => {
            if (active) setBranches(Array.isArray(data) ? data : []);
        }).catch(() => {
            if (active) {
                setBranches([]);
                setBranchesError(true);
            }
        }).finally(() => {
            if (active) setBranchesLoading(false);
        });
        return () => { active = false; };
    }, [isOwner, userKey]);

    const runMutation = useCallback(async (operation) => {
        setMutationsInFlight((count) => count + 1);
        try {
            return await operation();
        } finally {
            setMutationsInFlight((count) => Math.max(0, count - 1));
        }
    }, []);
    const busy = mutationsInFlight > 0 || collectionOpen;
    const changeContext = (value) => {
        if (!busy) setContext(value);
    };

    const selectedBranchId = isOwner && context.startsWith('branch:') ? context.slice('branch:'.length) : null;
    const branchIsRegistered = selectedBranchId && branches.some((branch) => String(branch.id) === selectedBranchId);
    const scopeParams = useMemo(
        () => context === 'legacy' ? { legacy_only: true } : selectedBranchId ? { branch_id: selectedBranchId } : {},
        [context, selectedBranchId]
    );
    const contextKey = `${userKey}:${context}`;

    if (!isOwner) {
        const staffKey = `staff:${userKey}`;
        return <CajaWorkspace key={staffKey} contextKey={staffKey} scopeParams={{}} runMutation={runMutation} onCollectionChange={setCollectionOpen} />;
    }

    return (
        <div className="space-y-4" data-testid="caja-owner-context">
            <Card>
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <label htmlFor="caja-branch-context" className="text-sm font-medium">Contexto de caja</label>
                        <p className="text-xs text-muted-foreground">La vista consolidada es de solo lectura.</p>
                    </div>
                    <select
                        id="caja-branch-context"
                        data-testid="caja-branch-context"
                        className="h-11 min-w-56 rounded-md border border-border bg-background px-3 text-sm"
                        value={context}
                        disabled={busy}
                        onChange={(event) => changeContext(event.target.value)}
                    >
                        <option value="all">Todas las sucursales · consolidado</option>
                        {branches.map((branch) => <option key={branch.id} value={`branch:${branch.id}`}>{branch.name}</option>)}
                        <option value="legacy">Registros históricos sin sucursal</option>
                    </select>
                </CardContent>
            </Card>
            {branchesLoading && <p className="text-sm text-muted-foreground">Cargando sucursales…</p>}
            {branchesError && <p role="alert" className="text-sm text-destructive">No se pudieron cargar las sucursales. Las operaciones por sucursal no están disponibles.</p>}
            {!branchesLoading && !branchesError && branches.length === 0 && <p className="text-sm text-muted-foreground">No hay sucursales registradas para operar.</p>}
            {context === 'all' ? <ConsolidatedCashView key={contextKey} branches={branches} userKey={userKey} />
                : <CajaWorkspace
                    key={contextKey}
                    ownerContext
                    contextKey={contextKey}
                    scopeParams={scopeParams}
                    selectedBranchId={selectedBranchId}
                    branches={branches}
                    canOpen={!branchesError && !!branchIsRegistered}
                    runMutation={runMutation}
                    onCollectionChange={setCollectionOpen}
                />}
        </div>
    );
}
