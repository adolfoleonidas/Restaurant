import { useEffect, useMemo, useState } from 'react';
import { listBranches } from '@/lib/api/branches';
import {
    branchScopeParams,
    readRememberedScope,
    rememberScope,
    resolveBranchScope,
} from '@/lib/branchScope';

/**
 * Branch scope of the floor. The owner sees the whole business, so they choose
 * which salón to look at; the rest of the staff is pinned by the server.
 */
export default function useBranchScope(user, isOwner) {
    const [branchCatalog, setBranchCatalog] = useState({
        loading: false, error: false, branches: [], resolved: false,
    });
    const [scope, setScope] = useState(null);

    useEffect(() => {
        if (!isOwner) {
            setBranchCatalog({ loading: false, error: false, branches: [], resolved: true });
            setScope(null);
            return undefined;
        }
        let active = true;
        setBranchCatalog((current) => ({ ...current, loading: true, error: false }));
        listBranches().then(({ data }) => {
            if (!active) return;
            const branches = Array.isArray(data) ? data : [];
            setBranchCatalog({ loading: false, error: false, branches, resolved: true });
            setScope(resolveBranchScope({
                isOwner: true,
                branches,
                remembered: readRememberedScope(user?.id),
            }));
        }).catch(() => {
            if (active) {
                // Sin catálogo no se puede elegir: el salón queda como estaba.
                setBranchCatalog({ loading: false, error: true, branches: [], resolved: true });
                setScope(null);
            }
        });
        return () => { active = false; };
    }, [isOwner, user?.id]);

    const scopeParams = useMemo(() => branchScopeParams(scope), [scope]);
    const scopeKey = scope || 'sin-alcance';
    // Quien elige piso espera a su catálogo: hasta entonces no se pide ninguno,
    // para no mostrar todas las sucursales mezcladas ni un instante.
    const scopePending = isOwner && !branchCatalog.resolved;
    const chooseScope = (next) => {
        setScope(next);
        rememberScope(user?.id, next);
    };

    return {
        branchCatalog, scope, scopeParams, scopeKey, scopePending, chooseScope,
    };
}
