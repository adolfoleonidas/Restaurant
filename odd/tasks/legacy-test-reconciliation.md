# Reconcile the authorized legacy test records

## Objective and problem

Resolve the specifically reviewed legacy test accounts through normal supported UI actions, preserve order/payment/attention history, and close the historical register only when every closure blocker is absent. The legacy open register prevents new branch-register creation. This is an authorized test-data operation, not an application implementation or a physical cash reconciliation.

## Authority and constraints

- Human confirmed that all reviewed old records are test data and explicitly authorized the parent proposal on 2026-10-04.
- Destination: http://93.127.214.26:8081. Use only the already-open authorized in-app-browser session. No credential/token extraction, another account/session, SSH, Actions, direct HTTP/DB access, or remote channel.
- R1 scope: the five legacy cards reviewed in Caja: Mesa b22a (6), 659a (85), f1f0 (10), b862 (16), 9faf (113). These are displayed amounts, not proven unpaid balances. Re-check each actual ledger/proof/state before mutation.
- Cancel only accounts with zero amount paid, zero completed payments, and no pending/confirmed payment proof. Preserve canceled records and history. Use a truthful cancellation reason: Test account cleanup. Do not cancel a partially or fully paid account.
- R2 scope: the separately reviewed S/45 legacy account, Mesa f347, displayed Pagado / sigue en cocina. Complete its normal preparation/delivery/eligible attention-finalization as an explicitly simulated test journey. Retain its existing payment. No repeat charge, refund, void, transfer, new order, or new payment.
- R3 scope: close only the same historical branchless register after supported UI/backend validation shows no pending orders, proofs, or active attentions. Human explicitly approved closing_amount 1484.00 as a SIMULATED TEST AMOUNT, never as a physical count. Do not change the amount silently if expected totals change; stop to report the difference.
- No deletion, database reset, backfill, business scope expansion, new branch-register opening, installation, source code change, push, PR, merge, or deployment.
- Stop affected operations if identity is ambiguous, eligibility is unproven, the UI offers only an unsafe path, or additional out-of-scope blockers appear. Report partial progress without inventing a successful closure.

## Route, verification, and delivery

- Substantial operational work: three recoverable steps. Route per task is delegated direct, one bounded UI executor at a time; the parent owns structural readback/spot checks and local evidence commits. Delegate broad source/UI reading to keep the parent context bounded.
- Source checkout: C:/Users/adolf/.codex/worktrees/restaurant-ui-redesign/Restaurant, branch codex/branch-isolation-deployment, initial HEAD 9c60a55cab9eb9c04ed8948bebd4e7853cb958d1. Deployed source 79ffb5475e83e742646258f5f6379844ff3039f1.
- Strict TDD remains enabled by AGENTS.md for source changes. No application source is changed here, so RED/GREEN source tests are N/A. Verification of record is observed UI state/ledger/proofs, confirmation messages, pending lists, and before/after screenshots for each authorized operation. Do not run local or live test scripts to change records.
- RDD clone-local OFF, global unchanged, disabled/unmanaged. No native review lifecycle or receipt. Source normalization/build/tests are N/A for this record-only operation; whitespace and structural readback apply to this evidence document.
- Forecast <=150 authored documentation lines, advisory only. Delivery strategy ask-on-risk; no PR planned and no source compression. Local work-unit evidence commits only; remote Git delivery needs its own scoped intent.
- Engram mirror odd/legacy-test-reconciliation/tasks is PENDING: no authoritative runtime session identity. Do not invoke agent-attributed memory tools or invent an identity. Preserve this local recovery record.

## Tasks and acceptance

- [ ] R1: Re-check the five listed legacy accounts; cancel only independently eligible zero-paid/no-proof test records, then finalize their canceled attentions only where the supported eligibility check permits it. Record per-account observed eligibility/result; keep all ineligible/ambiguous records unchanged.
- [ ] R2: Re-check the paid S/45 account and its completed payment; perform its approved simulated preparation/delivery/finalization using supported controls without payment mutation. Verify the recorded payment remains and the attention is terminal.
- [ ] R3: Re-read pending blockers and the historical register summary. Close with simulated 1484.00 only if expected amount is still 1484.00 and no blockers remain. Verify historical status closed, saved closing amount/difference, retained history, and no newly opened register.

## Progress and evidence

- Before mutation: authorized read-only view confirmed one legacy open register with initial 444.00, cash collected 1040.00, expected cash 1484.00; five other cards totaling 230.00 displayed, and the S/45 paid/cooking card. Individual completed-payment/proof checks remain pending.
- Source mapping verified that cancellation requires zero paid and a reason; paid orders cannot be canceled as unpaid; attention completion is a separate guarded action; cash close rejects nonterminal orders/proofs/active attentions and requires an entered closing amount.
- R1 route: delegated direct UI worker; preparation/source mapping done, actual eligibility and mutations pending. First authorized-tab bind was attempted, but the required in-app-browser provider was unavailable; no alternate browser/session was selected and no record was viewed or changed.
- R2 route: delegated direct UI worker; pending R1 handoff and fresh scope-specific readback.
- R3 route: delegated direct UI worker; pending fresh empty-blocker proof and exact simulated-amount readback.

## Recovery and rollback boundary

Do not reverse a cancellation, recreate a payment, restore a backup, or reopen/replace a closed register automatically. Read the current per-record result before resuming. No blind retries of submissions or unknown-outcome mutations. Any changed expectation or additional legacy record is a human decision, not authority inferred from this checklist.

## Next step

Delegate R1 only, wait for a terminal handoff, verify its evidence and commit the local work unit. Continue R2 independently only within the original specific authority, then R3 only after all closure preconditions are observed.

### R1 UI handoff blocker

- **Observed:** the required existing in-app-browser tab could not be bound (`Browser is not available: iab`). The UI inventory did not provide an in-app-browser session. Per scope, no other browser session or account was used.
- **Outcome:** no reviewed card was re-identified, no ledger/proof inspected, and no cancellation/finalization submitted. R1 remains unchecked and all five records remain unverified/untouched by this worker. No screenshot was captured because the authorized surface was unavailable.
- **Next step:** parent must restore/provide the exact authorized in-app-browser tab, then re-dispatch R1. Do not infer eligibility or retry any mutation from the previous snapshot. R2/R3 remain untouched.

### Parent read-only spot check — scope clarification required

- The parent can still observe the original in-app-browser tab, without selecting another browser/account. Its current UI differs from the authorized historical snapshot: it shows Apertura de caja, a pre-entered initial-amount value of 123, and seven waiting accounts with table-number labels. No historical context selector or the six authorized cards is visible. This does NOT prove that the old register was closed or that the active account is unchanged.
- No parent or worker cancellation, simulated service finalization, cash-close, payment, or new-register submission occurred. The parent did not navigate away, edit the pre-entered amount, reload, or overwrite the user's in-progress form after detecting the changed context.
- All R1/R2/R3 boxes remain unchecked. Eligibility, the current historical register state, and active account/context require clarification; no unsupported financial result is inferred. Source tests/build are N/A and no app source changed.
- The worker surface-unavailability note is preserved as its observed result, not assumed to apply to the parent. Stop affected record operations and ask which account is currently active before resuming; do not reuse another authenticated account or broaden the target scope implicitly.
- Local scope/progress is preserved in this document; Engram mirror remains pending runtime identity. No remote Git delivery is performed.

### Active role verified — historical session handoff pending

- Human reports testing cashier, waiter, and administrator accounts. The parent read-only sidebar inspection confirms that the currently active session displays role Cajero, not the former administrator context. This is current UI evidence only, not a claim about other sessions.
- Only the navigation drawer was opened/closed. The seven-account opening form and its pre-entered amount 123 remained unchanged; no logout, login, cancellation, payment, new-register opening, or cash-close was submitted.
- The historical context selector is absent in this staff view. Resume requires the human to restore the previous administrator session; do not change accounts, enter credentials, or operate these different waiting records on their behalf. R1/R2/R3 remain incomplete.
- Prior scope-preservation evidence commit: ddf953e1a0cb6b3847bdbd64a65c67b4455b36aa. This clarification is passive documentation only; application checks are N/A, RDD remains OFF, memory mirror remains pending runtime identity, and no remote Git operation is authorized/performed.

### Administrator-login claim checked in the original tab

- Human reports returning as administrator. The original authorized in-app tab still showed Cajero. After announcing and performing exactly one read-only page refresh, a fresh sidebar again showed Cajero; no administrator/historical context was available. Do not conclude that the human failed to log in elsewhere or switch browser profiles automatically.
- The refresh reset the unsubmitted draft amount 123 to blank and the history-period tab to its default. No opening form, order cancellation, service completion, payment, or cash-close was submitted; live business records remain untouched by this task.
- Current-role screenshot: C:/Users/adolf/.codex/visualizations/2026/10/02/01a0fa09-117d-7212-ab8d-ba8293258612/cash-current-role.jpg. The drawer was closed and the same tab was retained for human handoff. User must log in as administrator in this exact integrated tab, without sharing credentials, before mutation can resume.
- R1/R2/R3 remain incomplete; mirror pending runtime identity, no source/build/test/review/remote-Git operation. Prior passive-role checkpoint is 86a80a0bc890c10215a10b5e7c36ab530d98d1bf.
