import { useEffect, useRef, useState } from 'react';
import { listBranches } from '@/lib/api/branches';

export default function useBranchNames(scopeKey) {
    const [catalog, setCatalog] = useState({ scopeKey: null, names: {} });
    const generation = useRef(0);

    useEffect(() => {
        const requestGeneration = ++generation.current;
        if (!scopeKey) {
            setCatalog({ scopeKey: null, names: {} });
            return () => { generation.current += 1; };
        }
        setCatalog({ scopeKey, names: {} });
        listBranches().then(({ data }) => {
            if (generation.current !== requestGeneration) return;
            const names = Object.fromEntries((Array.isArray(data) ? data : [])
                .filter((branch) => typeof branch?.id === 'string' && typeof branch?.name === 'string')
                .map((branch) => [branch.id, branch.name]));
            setCatalog({ scopeKey, names });
        }).catch(() => {
            if (generation.current === requestGeneration) setCatalog({ scopeKey, names: {} });
        });
        return () => { generation.current += 1; };
    }, [scopeKey]);

    return catalog.scopeKey === scopeKey ? catalog.names : {};
}
