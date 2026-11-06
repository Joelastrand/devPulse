# Team system overview (Systemoversikt)

## Status
Approved for the autonomous run. Decisions D-1 to D-10 were resolved from repository conventions and the feature prompt (see "Architecture decisions").

## Problem
Teams own software systems but have no team-scoped, qualitative view of how well each system is maintained, kept secure, kept available, which team members know it, and where its technical documentation lives. Knowledge is often concentrated in one or two people without the team noticing.

## User outcome
A team member with write access to a team can register the systems the team owns, record qualitative team assessments of availability, maintainability and security, associate the team members who know each system, link to the Backstage documentation, and see aggregate knowledge-concentration and attention needs across the team's systems.

## Scope
- New tab **Systemoversikt** on the team route, after Oversikt and Roadmap.
- Per-team system inventory: create and edit (name, description, Backstage URL).
- Qualitative assessments for three attributes: Tilgjengelighet, Vedlikehold, Sikkerhet. Each has a value, an optional short note, and the time and assessor of its last change.
- Knowledge associations: current team memberships associated with a system.
- Summary cards, search, attention and knowledge-risk filters, responsive table/card list.
- Aggregate knowledge-risk panel and a quality explanation panel.
- Backstage link validation and an "Åpne i Backstage" action.
- Server-side authorization for every read and write.

## Out of scope
- Uptime, SLO/SLA, availability percentages, synthetic monitoring, any telemetry integration.
- Automated security scanning, or any statement that a system is secure or certified.
- Backstage API integration, fetching, scraping, synchronization.
- Deleting systems.
- Employee rankings, individual performance scores, productivity tracking, gamification.
- Per-person concentration lists or "single point of failure" judgments about a person.
- New permission roles or admin-only permissions.
- Sorting and pagination.
- A general "system status" field (see D-3).

## Key concepts
- **System**: a team-owned software system, identified by an opaque `systemId`.
- **Assessment**: a qualitative value for one attribute, with an optional note, `assessedAt` and `assessedBy`.
- **Assessment value**: `god` (God), `trenger_oppfolging` (Trenger oppfølging), `kritisk` (Kritisk) or `ikke_vurdert` (Ikke vurdert). `ikke_vurdert` is the default and is never a positive assessment.
- **Knowledge member**: a current team membership associated with a system, referenced by its existing opaque `memberRef`. The association is self-reported team information; it does not certify expertise.
- **Knowledge-risk band**: derived from the number of knowledge members of one system (BR-9).
- **Attention**: a derived boolean per system, true when any assessment is `kritisk` or `trenger_oppfolging` (BR-10).

## Actors and access
| Actor | Read the team's systems | Create, edit systems, assessments, knowledge, Backstage link |
|---|---|---|
| Unauthenticated | No (`unauthenticated`) | No |
| Signed-in non-member, not app admin | No (`forbidden`) | No |
| App admin, not a member | Yes (same team-read rule as other team screens) | No |
| Team member on an `active` team | Yes | Yes |
| Team member on a `disabled` team | Yes | No (`team_disabled`) |

Lead role and app-admin status add no write permission. Writes use the same rule as roadmap writes: a genuine membership on an `active` team. Competency or role profiles grant nothing.

## User stories
1. As a team member, I want to register a system the team owns, so that it appears in the team's inventory.
2. As a team member, I want to record a qualitative assessment for availability, maintainability and security, so that the team sees where attention is needed.
3. As a team member, I want to associate the team members who know a system, so that knowledge concentration becomes visible.
4. As a team member, I want to open a system's Backstage documentation, so that I can find technical documentation quickly.
5. As a team member, I want to see aggregate knowledge risk and attention needs, so that I can plan knowledge sharing and maintenance.
6. As a team member, I want to search and filter the inventory on any screen size.

## Behavioral requirements
- **BR-1** The team navigation shows `Oversikt`, `Roadmap`, `Systemoversikt` in that order. `Systemoversikt` links to `/teams/[teamId]/systems`, which is the only route marked `aria-current="page"` for that link.
- **BR-2** The list read returns only systems stored with the requested `teamId`, for a caller `authorizeTeamAccess` decides is `member` or `admin`. Other callers get `forbidden`; an unverified token gets `unauthenticated`; an undecidable check gets `read_failed`.
- **BR-3** Each system view contains `systemId`, `name`, `description` (or null), `backstageUrl` (or null), the three assessments (`value`, `note` or null, `assessedAt` or null), `knowledge` (list of `{ memberRef, displayName | null, isSelf }`), `knowledgeRisk`, `attention`, `createdAt`, `updatedAt`. It never contains a uid, e-mail, membership document id, or audit uid.
- **BR-4** Create (`POST /api/teams/[teamId]/systems`) requires a genuine membership of the caller on an `active` team. It stores `teamId` from the route with a server-generated `systemId`, and sets assessments to `ikke_vurdert` unless values are supplied. Body keys are allow-listed. A wrong envelope is `invalid_request`; a bad field value is `invalid_input`.
- **BR-5** Update (`PATCH /api/teams/[teamId]/systems/[systemId]`) replaces the editable set (`name`, `description`, `backstageUrl`, `assessments`, `knowledgeMemberRefs`) and needs the same authorization as create. A system that does not exist in that team returns `not_found`, which never reveals another team's record.
- **BR-6** Traceability: when an assessment's value or note changes, `assessedAt` becomes the server time and `assessedBy` the caller's uid (stored, not returned). An unchanged assessment keeps its previous `assessedAt` and `assessedBy`.
- **BR-7** Knowledge members: each `knowledgeMemberRefs` entry must resolve to exactly one current membership of the same team, validated inside the write transaction. Duplicates, unknown refs, other teams' refs and malformed refs are rejected with `invalid_knowledge`. At most 50 associations per system.
- **BR-8** Backstage URL is optional. When present it must be an absolute `https:` URL with no username or password, a non-empty hostname, no whitespace, and at most 2048 characters. It is stored in normalized form. Otherwise the write is rejected with `invalid_input`.
- **BR-9** Knowledge-risk band from the number of resolvable knowledge members N: `0` → "Ingen registrert kompetanse"; `1` → "Høy kompetanserisiko"; `2` → "Forhøyet kompetanserisiko"; `3` or more → "Lavere konsentrasjonsrisiko". These are fixed, documented rules, not a numeric score.
- **BR-10** Attention: true when any assessment is `kritisk` or `trenger_oppfolging`. A system with all three assessments `ikke_vurdert` is neither healthy nor attention-flagged; it is counted as not yet assessed.
- **BR-11** Summary cards show counts derived from the loaded list only: `Systemer` (total), `I god stand` (all three `god`), `Trenger oppfølging` (BR-10 attention count), `Kompetanserisiko` (systems with N ≤ 1). No percentages and no team-member totals.
- **BR-12** Knowledge-risk panel: count of systems per band (BR-9), and the count of systems whose only knowledge member is a single person. Aggregate only, with no names and no ranking.
- **BR-13** Search matches name and description (case-insensitive substring). The attention filter has the values `Alle` and `Trenger oppfølging`. The knowledge-risk filter has the values `Alle` and each BR-9 band. Filters run client-side over the already-authorized list and never widen it.
- **BR-14** A quality explanation panel explains the three attributes and states that the assessments are qualitative team self-assessments, not automated checks or certifications.
- **BR-15** When a Backstage URL is present, the row or card shows an `Åpne i Backstage` link with `target="_blank"` and `rel="noopener noreferrer"`, whose accessible name includes the system name. When absent it shows "Ingen Backstage-lenke".
- **BR-16** Write controls are shown only when the list read returned `canEdit: true`. The server enforces every write regardless.
- **BR-17** Loading, empty, no-search-results, read-error and write-error states show meaningful Norwegian text. No demo or invented records are ever shown.

## Edge cases and failure behavior
- A stored system document that fails validation is skipped on read and never partially shown.
- A knowledge ref whose membership was later removed does not resolve, so it is omitted from the view and from the risk count. The stored ref is not rewritten.
- Display names unavailable: the entry shows "Medlem uten navn" and is still counted.
- More than 500 systems for a team: the first 500 are returned with `truncated: true`, shown as a notice. Create is refused with `limit_reached` once 500 systems exist.
- Concurrent writes: last write wins within a transaction (D-7).
- Erasure in progress for the caller: writes are refused with `erasure_in_progress` through the existing write fence.
- Read or write infrastructure failure: `read_failed` / `persistence_failed`; the UI shows a generic error, never raw exception text.

## Security and privacy
- All reads and writes are server operations using the Firebase Admin SDK. `teamSystems` is denied to client SDK access by the existing deny-all rules. No rule change.
- `teamId` comes from the route and is verified through `authorizeTeamAccess` (reads) or the membership read inside the write transaction. Client-supplied team or uid values are never trusted.
- `memberRef` is the only identity accepted or returned for knowledge associations. uids and e-mails are never accepted as input or returned.
- Names, descriptions, notes and Backstage URLs may contain sensitive operational information. They are not logged, not included in error responses, and not placed in browser-test reports.
- Audit uids (`createdBy`, `updatedBy`, `assessedBy`) are stored, never returned.
- Writes include the erasure fence, as roadmap writes do.
- Input is validated server-side with an allow-list of keys and explicit field validation.
- Error responses carry error codes only.

## Architecture decisions
- **D-1 Storage**: collection `teamSystems`, document id = server-generated opaque `systemId` (`crypto.randomUUID()`), Admin-SDK access only. Persisted fields: `teamId`, `name`, `description?`, `backstageUrl?`, `availability`, `maintainability`, `security` (each `{ value, note?, assessedAt, assessedBy }`), `knowledgeMemberRefs`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`.
- **D-2 Location**: feature code in `src/features/team-systems/` (`domain`, `server`, `client`, `components`). Route entry points: `app/(app)/teams/[teamId]/systems/page.tsx`, `app/api/teams/[teamId]/systems/route.ts`, `app/api/teams/[teamId]/systems/[systemId]/route.ts`.
- **D-3 General status omitted**: the prompt lists general status as optional and the reference's "Normal / Utfordring" values have no authoritative source. The Status column becomes **Oppmerksomhet** (attention). Approved deviation.
- **D-4 Member identity**: the existing opaque `memberRef` of `teamMemberships`, as roadmap owners use it. Display names come from the existing profile batch reader.
- **D-5 Risk bands** are constants in `domain/team-system.ts`, documented in BR-9.
- **D-6 Aggregates** are computed per read and never persisted.
- **D-7 Concurrency**: last write wins within a transaction, with no version token, consistent with roadmap.
- **D-8 No delete** in this scope.
- **D-9 No sorting or pagination**: one bounded read of up to 500 systems, with a truncation signal.
- **D-10 Copy** is Norwegian; code identifiers are English.

## Test boundaries
| Boundary | Covers |
|---|---|
| Domain (`team-system.ts`: validation, bands, attention, Backstage URL) | BR-3, BR-8, BR-9, BR-10 |
| Server read (`list-team-systems.ts`) | BR-2, BR-3, BR-11, BR-12 |
| Server write (`write-team-systems.ts`: create, update, membership validation, traceability, fence) | BR-4 to BR-8 |
| API route handlers (status mapping, allow-listed body, no raw error text) | BR-2, BR-4, BR-5 |
| Client gateway (strict response parsing) | BR-2, BR-3 |
| Components (page, table/cards, search and filter, form, states, Backstage link) | BR-1, BR-11 to BR-17 |
| `TeamRouteNav` | BR-1 |

## Acceptance criteria
- [ ] Navigation shows `Oversikt`, `Roadmap`, `Systemoversikt` with the correct hrefs and `aria-current`.
- [ ] Unauthenticated and non-member requests to the list and write APIs are refused and return no system data.
- [ ] A system from team A is never returned for team B; updating another team's system id returns `not_found`.
- [ ] Only genuine members on active teams can create or update; app-admin non-members cannot write.
- [ ] Knowledge associations accept only current memberRefs of the same team.
- [ ] Backstage URLs: only https without credentials; invalid ones are rejected; stored normalized.
- [ ] Assessments default to `ikke_vurdert`; a positive status is never shown for missing data.
- [ ] Risk bands and attention rules match BR-9 and BR-10 in unit tests.
- [ ] Summary counts and aggregates match the loaded list (tests).
- [ ] Responses never contain uid, e-mail, membership id or audit uids (test).
- [ ] UI works at 320 px (cards) and on desktop (table) without horizontal overflow. Browser verification: see TASKS.md (not_verified if no authenticated harness is available).
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` run and results recorded.

## Open questions

### OQ-1 (resolved 2026-11-05): account-erasure coverage for `teamSystems`
`teamSystems` persists person identifiers that the account-erasure contract (`docs/features/account-erasure/SPEC.md`, Erasure inventory, BR-5/BR-12) requires to be swept.

**Owner decision (approved 2026-11-05):**
- **A-13 ANONYMIZE:** `createdBy`, `updatedBy`, `assessedBy` (inside each assessment map) are set to `null`. Values, notes and `assessedAt` are kept.
- **A-14 DETACH:** the erased membership's `memberRef` is removed from `knowledgeMemberRefs`. Other members and the system record are kept.

Implemented in the account-erasure registry, the `actor_audit` and `memberships` steps, and ordinary membership removal. See `docs/features/account-erasure/SPEC.md`, "Decision log: teamSystems erasure coverage". The inventory guard now accepts the collection.

## Known limitations
- **Membership read cap (resolved 2026-11-05).** Knowledge refs are no longer resolved against a team-wide scan of the first 501 memberships.
The read looks up only the distinct refs of the loaded systems, and the write looks up only the refs in the request (at most 50).
Both use `teamId ==` plus `memberRef in [...]` lookups in chunks of 10 (`MEMBER_REF_LOOKUP_CHUNK_SIZE`), so no membership is silently dropped and no team is misclassified by size.
Tradeoffs for the owner: (a) read cost grows with the distinct refs across the team's systems, worst case about 500 systems times 50 refs in sequential chunks; realistic teams need a handful of lookups;
(b) the query needs Firestore index coverage for `teamId` equality with `memberRef in`, an index check to run before deployment that cannot be verified without an environment;
(c) other features (roadmap, development conversations, team skills) still use the 501 pattern and are out of scope here.

- **Browser verification (TASK-007) is not verified.** See TASKS.md.

## Round 2: seven-attribute model (corrective scope)

Status: domain, persistence and server layers implemented and tested. Compact matrix, shared explanation dialog, detail view, progressive-disclosure form, mobile cards and browser verification are **not yet implemented**; they are tracked as Ready tasks in TASKS.md (TASK-008 onward). Earlier BR/D entries stay as recorded; the rules below supersede them where they conflict.

- **D-11 Seven attributes.** `ASSESSMENT_ATTRIBUTES` = `availability` (Tilgjengelighet), `reliability` (Pålitelighet), `maintainability` (label "Vedlikehold og endring"; the persisted key is kept, so no migration), `security` (Sikkerhet), `testability` (Testbarhet), `deployability` (Utrullingsbarhet), `observability` (Observerbarhet). Each has the same value set and metadata as before.
- **BR-18 Legacy compatibility.** A stored document without one of the four newer keys is valid. The missing attribute reads as `ikke_vurdert` with null note, `assessedAt` and `assessedBy`. It is never treated as `god`. A present but malformed attribute still skips the document (BR-3 edge case). Existing three-attribute values and metadata are preserved on read and on partial update.
- **BR-11 (revised) Summary.** `I god stand` requires all seven attributes `god`. `Trenger oppfølging` is unchanged (any `kritisk` or `trenger_oppfolging`). Unassessed attributes never count as healthy.
- **BR-19 Partial update.** An attribute absent from the request keeps its stored value and metadata (already the write behaviour; now covered by tests for the seven-key model).
- **Erasure.** The erasure policy (A-13, A-14) covers `assessedBy` inside every attribute map, not only the three legacy keys. Coverage for all seven `assessedBy` leaves is implemented (inventory, actor-audit adapter, sweep counter, tests); the actor-audit exact-count test now expects 24 closed targets.
- **Out of scope in round 2 (unchanged):** no uptime percentages, no numeric score, no integration with monitoring platforms, no employee scoring.
