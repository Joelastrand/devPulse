# Team system overview — Verification record

Specification: [SPEC.md](./SPEC.md) · Tasks: [TASKS.md](./TASKS.md)

## 2026-11-05 — OQ-1 implementation and gates

### Account-erasure coverage (OQ-1, owner approved 2026-11-05)
- **A-13 (ANONYMIZE)** `teamSystems.createdBy`, `updatedBy`, `assessedBy` (inside `availability`, `maintainability`, `security`).
  Implemented: registry rows (`src/features/account-erasure/server/inventory.ts`), five closed actor-audit targets, nested-field
  clear in `erasure-adapters.ts`, dotted-field read in `actor-audit-erasure.ts`. Tests: `actor-audit-team-systems.test.ts` (8).
- **A-14 (DETACH)** `teamSystems.knowledgeMemberRefs`. Implemented in the `memberships` step (`membership-erasure.ts`), in ordinary
  removal (`membership-destruction.ts`, `membership-destruction-adapter.ts`), and in the production adapter
  (`erasure-adapters-team.ts`). The step reads systems with `array-contains` on `teamId` and `knowledgeMemberRefs`, writes the
  filtered list (the pure `withoutMemberRef`), and deletes the membership only when no system in the team still names its ref.
  Tests: `membership-erasure-knowledge.test.ts` (9) covering multi-system detach, order preservation, single-member and empty
  lists, unrelated members and other teams, budget-1 batches, idempotent repeat, and failure-then-retry.
- **Team-system reads and writes after erasure.** A null `createdBy`, `updatedBy` or `assessedBy` no longer skips the record
  (`team-system-record.ts`). An edit keeps a null creator; the editing member is not stamped as creator (`write-team-system.ts`).
  Tests: `write-team-system.test.ts` (new case), `list-team-systems.test.ts` (3 new cases: record kept after erasure, knowledge risk
  recalculated after detach, stale ref dropped).
- **Inventory guard.** `src/features/account-erasure/server/inventory.test.ts` now passes. It previously failed on the
  unregistered `teamSystems` collection and `assessedBy` field. The guard was not weakened. The SPEC row list in that test now has
  A-1 to A-14.
- **Verification sweep.** A-13 is counted by field equality (the three nested paths summed). A-14 is deferred per membership, like
  A-5, and is cleared by the `memberships` step. `ROW_OWNING_STEP` maps A-13 to `actor_audit` and A-14 to `memberships`.
- **Docs.** `docs/features/account-erasure/SPEC.md` (rows A-13 and A-14, BR-12 and BR-17 ranges, memberships step, decision log
  "teamSystems erasure coverage"), `docs/DATA-MODEL.md` (TeamSystem row).

### Independent security/privacy review (security-review skill, 2026-11-05)
- Outcome: **PASS WITH RISKS.** No Critical, High or Medium findings.
- Checked: every erasure transaction reads before it writes (the systems query runs only when no roadmap write is queued);
  null actor fields are never used as authorization; the write path does not stamp the editor as creator; matching is by
  `teamId` plus opaque `memberRef`, never by uid; every operation is bounded by `maxWrites`; no identifiers are logged.
- Low: pre-fix ordinary removals could have left a stale `memberRef` in `knowledgeMemberRefs`. A-14 is deferred in the sweep, so
  these are not found. The feature is not deployed (see SPEC), so this is most likely empty. Recommended: a one-off check on any
  environment that has run `writeTeamSystem` before this change. Not run here (no access to environments).
- Review gap: the `array-contains` and `teamId ==` query needs a composite-index check (AE-IDX). Emulator verification is not
  available here.

### Quality gates (run 2026-11-05)
- `pnpm test`: 541 files passed, 1 skipped; 9468 tests passed, 2 skipped.
- `pnpm typecheck`: passed (no errors).
- `pnpm lint`: 0 errors, 3 warnings. Two warnings are in `src/features/team-systems/components/TeamSystemsPage.test.tsx`
  (an unused eslint-disable directive and a missing `useEffect` dependency). One is in
  `src/features/forum/server/create-reply.transaction.test.ts` (unused variable), which predates this change.
- `pnpm build`: exit code 0 (Next.js 16.3.4). The run that produced this result was a single chained run in the background. A
  second, separate `pnpm build` attempt was refused by the Next.js lock while the first build was still running.

## 2026-11-05 — membership read cap fix and TASK-007 (read-only run)

### Membership lookup (501 cap) — resolved
- Before: knowledge refs were resolved against one `limit(501)` scan of the team's memberships (read and write). A ref outside that slice was refused on write (`invalid_knowledge`) and silently dropped from the read view and risk band.
- After: the read looks up the distinct refs of the loaded systems; the write looks up the refs in the request (at most 50). Lookups are `teamId ==` plus `memberRef in`, in chunks of `MEMBER_REF_LOOKUP_CHUNK_SIZE` (10). No team-wide scan, no truncation of members.
- Authorization: unchanged. The query is filtered by the requested `teamId` after `authorizeTeamAccess` (read) or the in-transaction membership read (write). Only `memberRef` and display names are returned, as before.
- Tests: `list-team-systems.test.ts` (membership boundaries 1, 2, 500, 501, 600 memberships; chunk size bound and distinct-ref lookups; fail-closed on duplicate refs; zero-resolvable case), `write-team-system.test.ts` (accept at 1, 2, 500, 501, 600 memberships; refuse unknown ref at 600; 50 refs across chunks). The 0-membership case cannot be read by any caller (a reader must be a member), so it is covered as one member with an unresolvable ref.
- Review: independent self-review of the diff. Remaining risks are recorded in SPEC "Known limitations" (index check, worst-case read cost, other features still on the 501 pattern).
- Not verified: Firestore index coverage for the `teamId` + `memberRef in` query, and query latency at scale. No emulator or isolated data is available.

### TASK-007 browser run (read-only) — partially verified
- Harness: `browser/team-systems-verify.spec.ts` (new). One sign-in per run, no form submission, no writes. Report: `.verify-output/team-systems/report.json` (git-ignored; contains only measurements, no page text or names).
- Environment: the dev server on port 3000 returned 404 for the systems routes (a stale process for this checkout). A fresh `next dev` on port 3001 served the current code; the run used `DEVPULSE_VERIFY_BASE_URL=http://localhost:3001`.
- Results (empty state, the test team has no systems), widths 320, 360, 768, 1024, 1280 px, light (`lys`) and dark (`mork`):
  - No horizontal overflow at any width or theme.
  - Nav shows three items; Systemoversikt has `aria-current="page"`.
  - Four summary cards and the knowledge-risk and quality panels render; empty-state copy "Ingen systemer registrert ennå" shown.
  - axe-core WCAG 2 A/AA: zero violations at every width and theme.
  - Focus indicator present on the Systemoversikt nav link (computed outline or box-shadow).
- Defect found and fixed: knowledge-risk tiles (`SystemInsights.tsx`) overflowed at 1280 px (the count rendered outside the tile). Changed to a wrapping flex row with a non-wrapping count. Re-checked at 1280 px (clean) and 768 px dark (clean; no mid-word breaks after switching away from `break-words`).
- Not verified (not_verified): populated table and cards, search and filters, knowledge associations, Backstage links, create and edit forms, assessment editing, keyboard traversal of forms, comparison with the populated reference image. Reason: no isolated fixture data; creating systems would write to shared data.
- Harness change: `browser/guards.ts` accepts `DEVPULSE_VERIFY_BASE_URL` only for `http://localhost:<port>`.

### Quality gates (2026-11-05, after this change)
- `pnpm test`: 541 files passed, 1 skipped; 9484 tests passed, 2 skipped (up from 9468 with the new boundary tests).
- `pnpm typecheck`: exit 0.
- `pnpm lint`: 0 errors, 3 warnings (the same pre-existing warnings as before: two in `TeamSystemsPage.test.tsx`, one in `create-reply.transaction.test.ts`).
- `pnpm build`: exit 0.
- Browser: `team-systems-verify` passed on the fresh server (see above).

### Ship status
Not safe to ship to an environment with real personal data yet. Blockers: (1) Firestore index check for `teamMemberships` (`teamId ==` with `memberRef in`) and for `teamSystems` (AE-IDX); (2) populated-data browser checks in TASK-007. The 501 cap is no longer a blocker for this feature. Other features still use the 501 pattern (roadmap, development conversations, team skills): a separate follow-up.

---

## Round 2 checkpoint (2026-11-05, UI correction): current status

Earlier checkpoints above are historical and are not overwritten. Current status of Round 2 UI work:

- **Reference 16 (matrix):** Implemented as seven compact status-icon columns, one icon per attribute, accessible names "Attribute: Status". The stacked "Vurderinger" cell is removed from the desktop table. Automated: `SystemMatrix.test.tsx` (icon names, headers, Backstage and edit actions in the row, no edit action without rights).
- **Search icon:** Root cause was the icon being positioned against the label-plus-input wrapper. The icon now sits in a wrapper that contains only the input. Automated: structural test only. **Not_verified visually** (no browser screenshot taken in this checkpoint).
- **Explanation dialog (Forklaring):** Implemented with Escape, Tab trap, focus return and scroll lock. Automated: open, content, Escape and focus return.
- **Reference 17 (form):** Seven collapsible rows; chevron, info button and status select are independent; notes survive collapse and status change. Automated: expansion, aria-expanded, note preservation, info button not changing status, saved-note rows opening expanded. Section A/C layout and the "Lagre endringer" label are **not yet** changed to match the reference.
- **Mobile cards:** Compact 7-column icon grid. **Not_verified** at 320/360/768/1024/1280 px and in both themes.
- **System detail view (TASK-011):** **Not implemented.**
- **Browser verification with populated data:** **not_verified.** No isolated fixture exists in this checkout and no shared or production data may be written. No screenshots of populated states were captured, so no claim of visual fidelity to references 16 or 17 is made.
- **Summary "I god stand" tests (TASK-014):** Still outstanding.
- **Security/privacy review (TASK-015):** Not run for this checkpoint.

Gates run on this checkpoint (after the final code change):
- `pnpm test`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0, 0 errors, 5 warnings (existing `TeamSystemsPage.test.tsx` hook warnings plus warnings in the new test setup).
- `pnpm build`: exit 0.
