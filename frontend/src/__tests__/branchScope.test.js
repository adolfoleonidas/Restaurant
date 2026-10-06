import {
    branchScopeKey,
    branchScopeLabel,
    branchScopeParams,
    readRememberedScope,
    rememberScope,
    resolveBranchScope,
} from '@/lib/branchScope';

const branches = [{ id: 'branch-a', name: 'Centro' }, { id: 'branch-b', name: 'Norte' }];

describe('salón branch scope', () => {
    beforeEach(() => window.localStorage.clear());

    it('leaves staff without a scope: the server already pins their branch', () => {
        expect(resolveBranchScope({ isOwner: false, branches, remembered: 'branch:branch-b' })).toBeNull();
        expect(branchScopeParams(null)).toBeNull();
    });

    it('leaves the floor unscoped when the venue has no branches to choose', () => {
        expect(resolveBranchScope({ isOwner: true, branches: [], remembered: 'branch:branch-a' })).toBeNull();
    });

    it('starts on the first branch and remembers the last choice', () => {
        expect(resolveBranchScope({ isOwner: true, branches })).toBe('branch:branch-a');
        expect(resolveBranchScope({ isOwner: true, branches, remembered: 'branch:branch-b' })).toBe('branch:branch-b');
        // Una sucursal borrada no puede dejar el salón en un piso inexistente.
        expect(resolveBranchScope({ isOwner: true, branches, remembered: 'branch:borrada' })).toBe('branch:branch-a');
        expect(resolveBranchScope({ isOwner: true, branches, remembered: 'legacy' })).toBe('legacy');
    });

    it('turns the context into query parameters', () => {
        expect(branchScopeParams('branch:branch-b')).toEqual({ branch_id: 'branch-b' });
        expect(branchScopeParams('legacy')).toEqual({ legacy_only: true });
        expect(branchScopeParams(null)).toBeNull();
        expect(branchScopeParams('branch:')).toBeNull();
    });

    it('names the active context for the selector and the advisories', () => {
        expect(branchScopeLabel('branch:branch-b', branches)).toBe('Norte');
        expect(branchScopeLabel('legacy', branches)).toBe('Sin sucursal');
    });

    it('keeps the choice per user and survives a browser that refuses storage', () => {
        rememberScope('owner-1', 'branch:branch-b');
        expect(readRememberedScope('owner-1')).toBe('branch:branch-b');
        expect(readRememberedScope('owner-2')).toBeNull();
        expect(branchScopeKey('owner-1')).toBe('salon-branch-scope:owner-1');
        // Modo privado: el navegador rechaza escribir y la elección vale sólo
        // para esta sesión, sin romper la pantalla.
        const proto = Object.getPrototypeOf(window.localStorage);
        const original = proto.setItem;
        proto.setItem = () => { throw new Error('modo privado'); };
        try {
            expect(() => rememberScope('owner-1', 'legacy')).not.toThrow();
            expect(readRememberedScope('owner-1')).toBe('branch:branch-b');
        } finally {
            proto.setItem = original;
        }
    });
});
