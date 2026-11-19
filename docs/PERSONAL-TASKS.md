# Personal tasks (Mine oppgaver)

Status: implemented in the working tree (not committed). Route `/tasks`. Scope: a private personal Kanban board for the signed-in
person. Source of truth: `src/features/personal-tasks/`, `app/api/me/tasks/`, `app/(app)/tasks/`.

## 1. Product behaviour

- **Route:** `/tasks`, sidebar item **Mine oppgaver** (Min utvikling group, after Samtaler). Authenticated; owner only. Team membership
  is not required and no team route exposes tasks.
- **Board:** four fixed columns, Backlog, Pågår, Blokkert, Fullført. Each column has its count, a scrollable list, and an inline
  **+ Legg til oppgave** form (Enter creates, Escape cancels, a failed create keeps the typed title). **Ny oppgave** opens the full
  editor with the title focused.
- **Editor:** title (1–160 characters), description (plain text, up to 5000), private notes (up to 10000), priority (none, Lav, Normal,
  Høy; never set automatically), due date (a calendar date, no time), status. Shows created, updated and completed times. Delete is
  permanent and asks for confirmation. Closing with unsaved edits asks before discarding; a failed save keeps the draft.
- **Moving tasks:** drag-and-drop (`@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2) moves a task between
  columns and reorders within a column. Each card has a grip button (the only drag source, so scrolling and clicking the title are unaffected).
  Keyboard: focus the grip, Space/Enter to pick up, arrows to move, Space/Enter to drop, Escape to cancel (Norwegian announcements).
  The status select on every card is still available and lists the other three statuses. Dragging is off while a search or filter is
  active and while another move is unconfirmed (the page says so).
- **Completion:** entering Fullført sets `completedAt` from the server clock. Leaving Fullført clears it, so the task returns to the
  active board. Reopening from history moves the task to Backlog.
- **Completed-task visibility** (preference `completedVisibility`): `last7` (default, "Siste 7 dager") shows a completed task on the
  board for seven days; `all` shows every completed task; `hidden` removes completed tasks from the board. Hidden or aged-out tasks
  remain completed and appear in history. Nothing is deleted automatically.
- **History** (Historikk tab): every completed task, newest first, 25 per page with "Vis flere". Open, reopen, and delete (through the
  editor, with confirmation). Search filters only the loaded history pages (see §12).
- **Search and filters:** a search field matches title and description (case-insensitive). Filters: priority, and "Bare forfalte"
  (due before today and not completed). A reset action clears them. Search and filters never change stored order.
- **Overdue:** a due date before today on an active task shows "Forfalt" on the card.
- **Mobile:** below `md`, one column is shown at a time, chosen with four buttons. All actions are reachable without dragging.
- **Limits:** at most 500 tasks per person (creation is refused at the limit; nothing is dropped or truncated).

## 2. Storage

| Path | Document | Plaintext | Encrypted |
| --- | --- | --- | --- |
| `userDevelopment/{uid}/personalTasks/{taskId}` | one task | `createdAt`, `updatedAt`, `completedAt` (only while completed) | `content`: title, description, notes, status, priority, due date, position |
| `userDevelopment/{uid}/taskSettings/board` | board preference | none | `content`: `completedVisibility` |

- `taskId` is a server-generated random UUID. The owner is the verified token's uid. No owner field is stored in the document.
- Status is inside the envelope. The plaintext `completedAt` reveals only whether and when a task was completed, the same lifecycle
  exception goals use.
- Reads are bounded: the whole board is read in one query of at most 501 documents; a board over the limit fails closed.
- No Firestore composite index is needed: history is read as the bounded board and paged in memory (see §12).

## 3. Encryption and authorization

- Encryption: the existing v2 record envelope (`src/lib/encryption/record-envelope.ts`): AES-256-GCM, HKDF-SHA-256 subkey of
  `ENCRYPTION_KEY`, fresh 12-byte IV per record, no plaintext fallback.
- Record binding (AAD): tasks use `personal-task:<uid>:<taskId>`; the preference uses `personal-task-settings:<uid>`. A record moved to
  another owner or id fails authentication (tested in `task-store.test.ts`).
- Stored content is re-validated on read. A malformed document, or one whose `completedAt` disagrees with its status, fails closed.
- Authorization: every route calls `verifyIdToken` (revocation check, disabled flag, NVE policy, erasure fence). The only subject is the
  verified uid. No uid, owner or team id is read from the path, query or body; a body that names one is refused (`invalid_request`).
- A task id that belongs to someone else is `not_found` (the existence of another person's task is not revealed).
- Team administrators and superadmins have no access route to these tasks. Nothing in the team or admin code reads
  `personalTasks`. Superadmin status does not widen access.
- Firestore rules are unchanged: client access stays denied for every collection.

## 4. API

All under `/api/me/tasks`, bearer token required, `Cache-Control: no-store`.

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/me/tasks` | Visible board (after the visibility rule) and preference | 200 `{ tasks, completedVisibility }` |
| `POST /api/me/tasks` | Create. Body: `title` (required), optional `description`, `notes`, `priority`, `dueDate`, `status` (default `backlog`) | 201 task |
| `PATCH /api/me/tasks/{taskId}` | Edit fields (absent = unchanged, `null` clears). `status` places the task in that column, before `beforeTaskId` or at the end | 200 task |
| `DELETE /api/me/tasks/{taskId}` | Permanent delete. Idempotent | 200 `{ ok: true }` |
| `GET /api/me/tasks/history?cursor&limit` | Completed tasks, newest first. `limit` 1–50 (default 25) | 200 `{ tasks, nextCursor }` |
| `PUT /api/me/tasks/preferences` | Body `{ completedVisibility }` | 200 `{ completedVisibility }` |

Error codes (`error` field): `unauthenticated` 401, `erasure_in_progress` 403, `auth_unavailable` 503, `invalid_request`,
`invalid_title`, `invalid_description`, `invalid_notes`, `invalid_status`, `invalid_priority`, `invalid_due_date`,
`invalid_position`, `invalid_visibility`, `invalid_cursor` 400, `not_found` 404, `task_limit` 409, `persistence_failed` 500.
Internal details are never returned. A task response is an explicit field allow-list with no owner.

## 5. Ordering

- Each task has a fractional `position` in its column (stored in the envelope). Order is position, then id.
- A move computes the new position inside the same Firestore transaction that reads the board and writes the task, so two concurrent
  moves cannot pick the same neighbours. The placement is "before `beforeTaskId`", or the end of the column when it is absent or null.
- Appending or prepending uses steps of 1024. A position between two neighbours is their midpoint. When the midpoint is not strictly
  between them (float precision), the column is renumbered in the same transaction (bounded by the 500-task limit).
- Positions persist across refresh, navigation, sign-out and sign-in, because they are stored.

## 6. Concurrency and failure handling

- Mutations use a per-task or create lock set before any state update, so a double submit is refused in the same tick.
- The browser shows success only after the server confirms. A failed move leaves the card where it was. `persistence_failed` and
  unknown outcomes are reported as "cannot confirm the change; reload" and the board is refetched.
- Late responses are checked against the auth generation they started under (the shared `useAuthGatedResource` guard). A response for a
  previous account cannot replace the current board or report success under another account (tested).
- A same-account token refresh refetches quietly and keeps the board and any open editor draft.
- Field edits are last-write-wins per task. There is no version token (see §12).

## 7. Account erasure

- Inventory rows **I-21** (`personalTasks`, subtree, DELETE) and **I-22** (`taskSettings`, subtree, DELETE) in
  `src/features/account-erasure/server/inventory.ts`.
- Erasure batches delete tasks and then the preference, path-only, without decrypting, paged by `maxWrites` and resumable
  (`personal-data-erasure.ts`). The sweep counters and the verification mapping cover both rows.
- The erasure fence refuses task writes during erasure (`erasure_in_progress`). Other people's tasks are not touched (tested).

## 8. Demo data (presenter account, `devpulse-nve`)

See [`DEMO-DATA-MAINTENANCE.md`](DEMO-DATA-MAINTENANCE.md) §"Personal task demo seed" for the procedure and the current preview.

- Dataset: `src/features/personal-tasks/demo/demo-dataset.ts`. 24 fictional tasks: Backlog 10, Pågår 6, Blokkert 3, Fullført 5. Three
  completed within seven days of the reference date, two older (history). One overdue active task. Fixed ids `kanban-demo-01`…`24`.
- Target: project `devpulse-nve`, owner uid `koEwzQcj5Uc0hnjTgZBLithgkYB3`. Any other value is refused before any Firebase call.
- Tool: `pnpm seed:personal-tasks-demo`. `--mode preflight` is read-only. `--mode write` needs `--confirm <digest>` of the same batch,
  is refused before any read without it, rebuilds and checks the plan inside one transaction, creates only missing records through the
  same codec, and verifies the result afterwards. It never updates, deletes, touches Auth, memberships or consent, or the ordinary tasks.
- Owner-only data written by the seed is ordinary personal data: it is covered by the erasure rows above.
- **Live write performed (approved):** project `devpulse-nve`, owner `koEwzQcj5Uc0hnjTgZBLithgkYB3`. Fresh preflight matched the
  approved plan exactly (24 create, 0 skip, 0 conflict, 0 ordinary tasks, digest `bde06402be2198ef`). Write mode with that digest created
  24 records. A read-only re-run then showed 24 skip, 0 create, 0 conflict. The digest reads `632cd699280ed69b` after the write because it
  covers the planned actions, which are now all `skip`. No other record was touched.

## 9. Tests

| Area | File |
| --- | --- |
| Validation, completion invariant, visibility, overdue, DTO allow-list | `domain/task.test.ts` |
| Placement, midpoints, renumbering, tie-breaking | `domain/task-ordering.test.ts` |
| Create, edit, move, reorder, delete, completion, history paging, preferences, isolation (in-memory port) | `server/task-operations.test.ts` |
| Encrypted persisted shape, no plaintext, AAD binding, status/completion consistency | `server/task-store.test.ts` |
| API boundary: 401/403/503, owner-only, body validation, status mapping | `app/api/me/tasks/tasks-routes.test.ts` |
| Board UI: loading, columns, creation (global and inline), move, search and filters, editor, history, account isolation | `components/TasksPage.test.tsx` |
| Erasure: task and preference deletion, paging, other people untouched | `account-erasure/server/personal-data-erasure.test.ts`, `inventory.test.ts`, `verification-sweep.test.ts` |
| Seed: dataset distribution, plan classification, write gate, runner, static guards (no Auth, no deletes, fixed target) | `demo/demo-seed.test.ts` |
| Scope guard: the owner-only store file is approved by exact path | `personal-goals/personal-goals-scope-guard.test.ts` |

Not run in this work: emulator tests and browser tests (see §11).

## 10. Documentation touched

`docs/ROUTES.md` (route, sidebar, API group), `docs/DATA-MODEL.md` (collections and erasure rows), `docs/SECURITY.md` (personal data),
`docs/DEMO-DATA-MAINTENANCE.md` (seed procedure and preview), `docs/KNOWN-LIMITATIONS.md`.

## 11. Verification status

- **Full suite:** `pnpm test:full` exit 0 on the final tree: 695 files passed, 11,220 tests passed, 4 expected-fail, 76 skipped. Typecheck and lint ran inside the tier (lint: warnings only, no errors).
- **Earlier full-suite failures** (14 timeouts in home and team-systems, one dependency-list test): the timeouts did not reproduce on a quiet run. They were contention from concurrent work (a dev server, emulators, and a browser run). The dependency-list test was updated for the approved dnd-kit packages.
- **Erasure tripwire:** `inventory.test.ts` passes (71 tests). The dnd-kit identifiers are approved by exact file and identifier only (see SECURITY §"Erasure tripwire exception").
- **TypeScript and ESLint:** `npx tsc --noEmit` passes; ESLint passes on the personal-task files.
- **Emulator:** run against an isolated Firebase Auth and Firestore emulator (demo project, separate ports). The app talked only to that emulator (the Admin SDK guard refuses non-demo projects).
- **Browser (Chromium, emulator-backed, isolated dev server on port 3100):** 13 of 13 pass. Covers pointer drag across columns, keyboard drag and drop, empty-column drop, within-column reorder with reload, Escape cancel, status-select fallback, a rejected move rolling back, display-only drag overlay, grip label and focus ring, the title still opening the editor, and no horizontal overflow at 375, 768 and 1440 px in light and dark. Screenshots are in `.verify-output/kanban-screens/` (git-ignored).
- **Not verified:** touch dragging on a device; announcement live-region text; account switch during a pending move in a browser (covered by jsdom tests only); the editor flows and history view in a browser; visual review of dark theme beyond the overflow check.
- **Production:** no deployment. No production write beyond the approved demo seed.

## 12. Known limitations

- **Drag-and-drop is partly verified.** Pure drop resolution and placement are unit-tested (`domain/task-move.test.ts`). Pointer and
  keyboard drags in a real browser and touch on a device are **not** verified (see §11). The status select is the fallback.
- **Erasure tripwire:** `src/features/account-erasure/server/inventory.test.ts` flags the dnd-kit API names `setNodeRef` and
  `setActivatorNodeRef` as uid-bearing field names. They are not person identifiers. Resolving this needs an explicit guard decision.
- **History search covers loaded pages only.** The board is bounded, so history is read as one bounded list and paged in memory. The
  search note in the UI says so. It can be widened to server-side search later.
- **No optimistic concurrency token.** Two devices editing one task: the later save wins per task. Positions are safe (transactional).
- **Search does not sort by relevance,** and it does not search notes (by design: notes are private and not shown on the board).
- **Time zone:** due dates are calendar dates. "Completed" and history dates use the viewer's local time for display only; the
  server's completion time is authoritative.
- **Reopen target:** a reopened task goes to Backlog. The user moves it from there.
- **Keyset history cursor** is encoded and validated but applied in memory; it is not a Firestore cursor (see §2).
