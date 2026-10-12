import { act } from 'react';
import useBranchScope from '@/pages/salon/useBranchScope';
import { listBranches } from '@/lib/api/branches';
import { readRememberedScope, rememberScope } from '@/lib/branchScope';
import { renderHook, flush } from '@/test-utils/renderHook';

jest.mock('@/lib/api/branches', () => ({ listBranches: jest.fn() }));

const branches = [{ id: 'a', name: 'Centro' }, { id: 'b', name: 'Norte' }];
const owner = { id: 'owner-1' };
let mounted;

const mount = async (user, isOwner) => {
    mounted = await renderHook(({ u, o }) => useBranchScope(u, o), { u: user, o: isOwner });
    await flush();
    return mounted;
};

beforeEach(() => {
    window.localStorage.clear();
    listBranches.mockReset();
});

afterEach(async () => {
    if (mounted) await mounted.unmount();
    mounted = null;
});

describe('useBranchScope', () => {
    test('staff that is not the owner is never asked to choose a branch', async () => {
        const { result } = await mount({ id: 'mozo-1' }, false);
        expect(listBranches).not.toHaveBeenCalled();
        expect(result.current.scope).toBeNull();
        expect(result.current.scopeParams).toBeNull();
        expect(result.current.scopeKey).toBe('sin-alcance');
        expect(result.current.scopePending).toBe(false);
        expect(result.current.branchCatalog).toEqual({ loading: false, error: false, branches: [], resolved: true });
    });

    test('the owner waits for the catalog, then lands on the first branch', async () => {
        let resolve;
        listBranches.mockReturnValue(new Promise((r) => { resolve = r; }));
        const { result } = await mount(owner, true);
        expect(result.current.scopePending).toBe(true);
        expect(result.current.branchCatalog.loading).toBe(true);

        await act(async () => resolve({ data: branches }));
        expect(result.current.scopePending).toBe(false);
        expect(result.current.scope).toBe('branch:a');
        expect(result.current.scopeKey).toBe('branch:a');
        expect(result.current.scopeParams).toEqual({ branch_id: 'a' });
        expect(result.current.branchCatalog.branches).toEqual(branches);
    });

    test('a remembered branch wins and choosing a branch remembers it', async () => {
        rememberScope(owner.id, 'branch:b');
        listBranches.mockResolvedValue({ data: branches });
        const { result } = await mount(owner, true);
        expect(result.current.scope).toBe('branch:b');

        await act(async () => result.current.chooseScope('legacy'));
        expect(result.current.scope).toBe('legacy');
        expect(result.current.scopeParams).toEqual({ legacy_only: true });
        expect(readRememberedScope(owner.id)).toBe('legacy');
    });

    test('a failed catalog leaves the floor unscoped and flags the error', async () => {
        listBranches.mockRejectedValue(new Error('boom'));
        const { result } = await mount(owner, true);
        expect(result.current.scope).toBeNull();
        expect(result.current.scopePending).toBe(false);
        expect(result.current.branchCatalog).toEqual({ loading: false, error: true, branches: [], resolved: true });
    });
});
