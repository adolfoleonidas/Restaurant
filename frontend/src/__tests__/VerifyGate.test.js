import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VerifyDialog from '@/components/cobro/VerifyDialog';
import CobroFooter from '@/components/cobro/CobroFooter';

global.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const click = (node) => act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

function Harness({ onConfirm }) {
    const [verified, setVerified] = React.useState(false);
    return (
        <VerifyDialog chargeAmount={25} handleConfirm={onConfirm} method="cash" setShowVerify={() => {}}
            setVerified={setVerified} verified={verified} verifyContext="" verifyCopy="Recibí el efectivo" verifyWarning="Aviso" />
    );
}

describe('charge verify gate', () => {
    it('keeps Registrar clickable and explains the missing tick instead of staying silent', async () => {
        const onConfirm = jest.fn();
        await act(async () => root.render(<Harness onConfirm={onConfirm} />));
        const btn = q('caja-verificar-registrar');
        expect(btn.disabled).toBe(false);
        await click(btn);
        expect(onConfirm).not.toHaveBeenCalled();
        const check = q('caja-verificar-check');
        expect(host.textContent).toContain('Marca la casilla para continuar');
        expect(check.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(check);
        const hint = host.querySelector(`#${check.getAttribute('aria-describedby')}`);
        expect(hint.textContent).toContain('Marca la casilla para continuar');
        expect(host.querySelector('.confirm-check').className).toContain('needs-attention');
    });

    it('submits once the box is ticked and clears the hint', async () => {
        const onConfirm = jest.fn();
        await act(async () => root.render(<Harness onConfirm={onConfirm} />));
        await click(q('caja-verificar-registrar'));
        await click(q('caja-verificar-check'));
        expect(host.textContent).not.toContain('Marca la casilla para continuar');
        await click(q('caja-verificar-registrar'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('cobro footer reason', () => {
    const base = { canRegister: false, handleRegister: jest.fn(), loading: false, netError: false, onOpenChange: jest.fn(), proofRefreshPending: false, registerLabel: 'Cobrar', result: null };
    it('links the visible reason to the disabled register button', async () => {
        await act(async () => root.render(<CobroFooter {...base} footerNote="El efectivo recibido no cubre el total" />));
        const btn = q('caja-cobrar-submit-button');
        expect(btn.disabled).toBe(true);
        const note = host.querySelector(`#${btn.getAttribute('aria-describedby')}`);
        expect(note.textContent).toBe('El efectivo recibido no cubre el total');
    });
    it('falls back to a generic reason when blocked without a specific note', async () => {
        await act(async () => root.render(<CobroFooter {...base} footerNote="" />));
        const btn = q('caja-cobrar-submit-button');
        const note = host.querySelector(`#${btn.getAttribute('aria-describedby')}`);
        expect(note.className).toContain('why');
        expect(note.textContent).toMatch(/Completa/);
    });
    it('says Cobrando… and sets aria-busy while the payment request is in flight', async () => {
        await act(async () => root.render(<CobroFooter {...base} canRegister loading footerNote="" />));
        const btn = q('caja-cobrar-submit-button');
        expect(btn.textContent).toContain('Cobrando…');
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute('aria-busy')).toBe('true');
    });
});
