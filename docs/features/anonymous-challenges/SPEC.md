# Anonymous Challenges

## Status
Approved — Phase 5 implemented (TASK-001 through TASK-007 Done; see
`TASKS.md`). This document was produced by `plan-feature`, following the
same process used for `docs/features/managed-surveys/SPEC.md` (Phase 4).

## Problem
DevPulse currently senses team wellbeing/delivery health only through
periodic, structured pulse surveys (three fixed 1-5 dimensions). There is no
channel for a team member to raise a specific, concrete, free-text problem —
"our deploy process has no clear owner," "code review regularly takes more
than two days" — as it comes up, without waiting for the next survey and
without the risk of being personally identified for raising it. Free-text
organizational-friction reports are more sensitive than a 1-5 numeric survey
answer (`docs/SECURITY.md` invariant 13) and need their own, deliberately
narrower privacy design rather than reusing the survey model unmodified.

## Goals
- Let an actual member of a team submit a free-text "challenge" (friction,
  problem, or improvement suggestion) for that team, without the application
  ever recording or being able to reconstruct who submitted it.
- Let that team's members and admins see the challenges raised for their own
  team, in plain (decrypted) form — the value of a challenge is that someone
  can act on it, so, unlike survey responses, individual content is meant to
  be read directly, not only aggregated.
- Give an app admin a minimal, explicit lifecycle (open → resolved →
  archived) plus a moderation-only delete, so a team's challenge list stays
  usable over time instead of growing forever.
- Preserve every existing privacy/security invariant this codebase already
  enforces (server-side authorization, team isolation, application-level
  encryption at rest, no client-side Firestore access, admin ≠ automatic
  raw-identity access) and extend them correctly to a feature where, unlike
  surveys, the *content* is deliberately individually visible while the
  *submitter* is not.

## Non-goals
- **Public/anonymous-link submission.** Unlike Managed Surveys'
  `public` access mode, a challenge is always submitted by an authenticated
  caller who holds actual membership in the target team — there is no
  shareable, identity-free submission link. (Rejected: a public/link mode
  would remove the one signal — real team membership — that scopes a
  challenge to the right team at all; nothing in the product intent asks for
  external/non-member submission.)
- **Comments, replies, voting/reactions, threads, or notifications** on a
  challenge. (Explicit brief constraint; also, a reply channel back to an
  anonymous submitter has no addressee to reach.)
- **AI classification, sentiment analysis, automatic moderation, or PII
  scanning/redaction** of challenge text. (Explicit brief constraint.)
- **Categories/tags.** Evaluated and rejected for v1 — no product need
  identified yet that a plain chronological list doesn't already serve;
  easy to add later without a breaking schema change (an optional field).
- **A distinct "acknowledged" lifecycle state** between `open` and
  `resolved`. Evaluated and rejected: unlike a genuinely enforced boundary
  (e.g. a survey's `open`/`closed`), "acknowledged" would carry no distinct
  authorization or visibility behavior of its own in v1 — with no comment
  channel back to an anonymous submitter, its only audience is other team
  members browsing the same list, who can already see a challenge is
  `open` (i.e., raised and not yet resolved). Mirrors the reasoning
  Managed Surveys used to reject a fourth "draft" lifecycle state
  (`docs/features/managed-surveys/SPEC.md` — "Why three states, not four").
- **Un-resolve / un-archive.** Both transitions are terminal in v1, mirroring
  Managed Surveys' "closing is terminal, no reopen" decision — no product
  need for reversal was identified, and it can be added later as a small,
  low-risk addition if needed.
- **Rate limiting / anti-abuse tooling** for submission. A submission
  requires real, authenticated team membership (not an anonymous public
  link), which already removes the classic bot/script abuse surface Managed
  Surveys' `public` mode has to accept as a documented tradeoff. Residual
  abuse (a real member submitting excessive junk) is accepted, undefended,
  for v1 — mirrors Managed Surveys' explicit choice not to build CAPTCHA/
  anti-abuse tooling in its first phase.
- **Pagination** of the challenge list. Expected per-team volume is small;
  revisit if usage shows otherwise.
- **A structured deletion audit log.** `deleteChallenge` permanently removes
  a Firestore document with no separate audit trail beyond ordinary
  (content-free) server request logs. Accepted limitation, not built in v1
  (see "Accepted residual risks").
- Any Developer Forum or Skill/Capability Tree behavior (Phases 6-7).

## Terminology
- **Challenge**: one team member's free-text report of a workplace
  friction/problem/improvement, submitted anonymously and scoped to exactly
  one team.
- **Derived challenge status**: `"open" | "resolved" | "archived"` —
  computed identically everywhere from two optional timestamps
  (`resolvedAt`, `archivedAt`), never a separately stored status field. See
  "Lifecycle."
- **Real team membership**: an actual `teamMemberships/{uid}__{teamId}`
  record (`docs/features/team-management/SPEC.md`), as distinct from
  `authorizeTeamAccess`'s broader `"admin" | "member" | "denied"` result — an
  app admin with no such record is not a real member. This distinction is
  reused unchanged from `docs/features/managed-surveys/SPEC.md` (BR-16),
  applied here to challenge *submission* specifically.

## Product behavior
1. A signed-in user who is an actual member of Team X opens `/teams/{X}`
   and sees a "Meld en utfordring" (report a challenge) panel: a short
   explanation of the anonymity guarantee, a textarea, and a submit button.
   There is no separate route/page and no team-selection step — the team is
   already established by the page the user is on (per `docs/UI-UX.md` —
   "no global team selector if navigation already establishes team scope").
2. On submit, the server verifies the caller's identity and real membership
   in Team X, verifies Team X is `active`, validates the text, encrypts it,
   and persists a new `challenges` document containing no identity field of
   any kind. The caller sees a plain success confirmation — no confirmation
   detail (e.g. no returned document ID) that could later serve as a
   correlation handle.
3. The same `/teams/{X}` page also shows a read-only, reverse-chronological
   list of Team X's non-archived challenges (open and resolved), visible to
   any member or admin of Team X — this is the point of the feature: the
   team can see what's been raised, without ever knowing by whom.
4. `/admin/teams/{X}` gains an "Utfordringer" management section: the same
   content, plus per-row admin actions (Marker som løst / Arkiver / Slett)
   and a separate archived section, mirroring the existing survey admin
   section's active/archived split.
5. Resolving, archiving, or deleting a challenge is an app-admin-only action
   — there is no team-level admin role in this codebase, and this feature
   does not introduce one (unchanged invariant,
   `docs/features/team-management/SPEC.md`).

## Authorization model
Three separate boundaries, deliberately not collapsed into one (mirrors the
"participation vs. viewing" split `docs/ARCHITECTURE.md` already documents
for Managed Surveys):

- **Submit** (`submitChallenge`): requires a verified Firebase identity
  *and* an actual `teamMemberships/{uid}__{teamId}` record for the target
  team. App-admin status alone is **not** sufficient — identical reasoning
  to Managed Surveys BR-16: administering a team's challenges and being
  eligible to raise one for it are different capabilities. Team must be
  `active` (freshly re-read at submit time).
- **Read — two separate operations, not one shared path** (revised in
  planning review): a challenge's visibility depends on *which surface* is
  reading it, and that distinction must be enforced server-side, not by the
  React tree hiding rows the server already sent it. This mirrors an
  existing, established precedent in this exact codebase —
  `src/features/surveys/server/get-current-team-survey.ts` is *"deliberately
  separate from [the] admin-only `TeamSurveysCollection`
  (`list-team-surveys.ts`) — this operation's authorization boundary is
  'team member or admin,' never admin-only, so it is not wired through that
  module."* Anonymous Challenges reuses the same split:
  - **`listTeamChallengesForMember`**: requires `authorizeTeamAccess`
    to resolve to `"admin"` or `"member"` for that `teamId` (the existing,
    broader viewing boundary Managed Surveys results already use). Returns
    only `open`/`resolved` challenges — an `archived` challenge is never
    included in this operation's response, for any caller, regardless of
    role. Backs `/teams/[teamId]`'s team-facing section (BR-27) — used
    identically whether the viewer happens to be a plain member or an app
    admin, since this is about *which page* is reading, not *who* is
    reading.
  - **`listTeamChallengesForAdmin`**: requires `requireAppAdmin` (the same
    boundary every other admin-only management action already uses — see
    "Manage" below). Returns challenges of every derived status (`open`,
    `resolved`, `archived`). Backs `/admin/teams/[teamId]`'s management
    section (BR-30) only — never called from the team-facing page.
  - Neither operation accepts a client-supplied status/visibility parameter
    of any kind (e.g. no `includeArchived` request flag exists on either) —
    which statuses an operation may return is fixed by *that operation's
    own* server-side authorization check, never by anything the client
    sends (BR-36).
  - A team's disabled status does not affect either boundary (viewing
    already-collected data remains available to existing members/admins,
    mirroring `docs/features/team-management/SPEC.md` BR-3 and Managed
    Surveys' "Results/history are unaffected" posture).
- **Manage** (`resolveChallenge`, `archiveChallenge`, `deleteChallenge`):
  requires `requireAppAdmin` — the same boundary every other admin-only
  team-management action in this codebase already uses (team create/
  disable, invitations, access-request resolution, survey open/close/
  delete/archive). Not gated on the owning team's `active` status
  (administrative cleanup remains possible on a disabled team, mirroring
  `closeSurvey`'s explicit "closing is neither opening nor answering"
  reasoning, `docs/features/managed-surveys/SPEC.md` TASK-004).

Every operation re-derives `teamId` from a trusted server scope (the
route's own path parameter for `submitChallenge`/`listTeamChallengesForMember`/
`listTeamChallengesForAdmin`; the fetched challenge's own persisted
`teamId`, cross-checked against the route scope, for the three management
operations) — never from a client-supplied value elsewhere in the request. A `challengeId` belonging to a different
team than the route scope is rejected (`wrong_team`), never silently acted
on, mirroring `openSurvey`'s existing cross-team defense.

## Privacy/anonymity model
**What the architecture guarantees.** A `challenges` document never
contains, and no code path in this feature ever writes, any of: `uid`,
`email`, `displayName`, or any other stable identity field. There is no
participation-tracking collection for challenges at all (unlike
`SurveyParticipation`) — see "Why no participation record" below — so there
is no companion document, shared transaction, or shared commit-timestamp
that could link a challenge to whoever submitted it. `challengeId` is a
random, Firestore-auto-generated document ID, never derived from `uid`,
`teamId`, or content. All Firestore access is server-side only via the
Firebase Admin SDK; `firestore.rules` denies the client-SDK path
unconditionally, identically to every existing collection.

**Why no participation record.** Managed Surveys needed `SurveyParticipation`
solely to enforce "at most one accepted response per identity per survey"
(BR-21/BR-22) — a real product requirement for a survey instance. Anonymous
Challenges has no equivalent requirement: repeated submissions, including
from the same person, are explicitly allowed (see "Non-goals" and BR-8).
With no dedup requirement, there is nothing for a participation record to
enforce — so this feature avoids entirely the one residual, raw-datastore-
only correlation risk Managed Surveys had to explicitly accept (the shared
commit-timestamp between a `SurveyResponse` and its `SurveyParticipation`,
`docs/features/managed-surveys/SPEC.md` — "Consistency vs. unlinkability
tradeoff"). This is a **stronger** anonymity posture than Managed Surveys'
`authenticated` mode, achieved by not building the one mechanism that
required the tradeoff in the first place.

**What is deliberately different from survey anonymity, by design.** A
survey response's *content* is never shown to anyone, ever — only an
aggregate above a minimum-response threshold. A challenge's content **is**
shown, individually, to any authorized viewer (any member or admin of the
team) — that is the entire point of the feature: someone has to be able to
read and act on "our deploy process has no clear owner." The guarantee this
feature makes is narrower and different in kind: *never who*, not *never
what*. This is a conscious, accepted product distinction (see BR-34), not
an oversight relative to the survey model's stricter content-secrecy
posture.

**Threat model.** Each item below is categorized: **(A)** guarantee
enforced by application architecture, **(B)** residual risk that cannot
reasonably be eliminated by this application, **(C)** explicitly accepted
product tradeoff, **(D)** future hardening, out of scope for v1.

| # | Risk | Category | Notes |
|---|---|---|---|
| 1 | Storing `uid`/`email`/`name` alongside challenge text | A | The persisted schema and every request/response type in this feature simply has no such field; nothing writes one. |
| 2 | Deterministic IDs linking submitter and challenge | A | `challengeId` is a random Firestore-generated ID; there is no `{uid}__{...}`-style deterministic ID anywhere in this feature. |
| 3 | Timestamps enabling correlation | B | `submittedAt` (full timestamp) is persisted for ordering, but only the **date** (not time-of-day) is ever returned to any client (BR-12) — reduces, but cannot eliminate, the residual risk that a small team + infrequent submissions lets someone who already knows a lot about each person's schedule guess based on timing + content. Inherent to any timestamped free text; not unique to this feature. |
| 4 | Audit logs recording identity + challenge together | A | BR-25/BR-26: no operation ever logs challenge plaintext/ciphertext; a log line may reference a `uid` alone or a `challengeId` alone, never both together. |
| 5 | API responses leaking identity | A | No identity field exists in any persisted record to leak. |
| 6 | Firestore metadata/correlation (raw `createTime` etc.) | B | Weaker than the Managed Surveys equivalent, since there is no companion participation document sharing a commit timestamp — this reduces to "an operator with raw Admin SDK/console access can see one document's own metadata," not a cross-document join. Outside this application's control either way (`docs/ARCHITECTURE.md`'s existing server-only trust boundary). |
| 7 | Client-side Firestore access | A | `firestore.rules` deny-all block, identical in form to every existing collection (BR-23). |
| 8 | App-admin access to content | C | Explicit, accepted design difference from surveys: an app admin (and any team member) can read challenge text by design — the feature's purpose requires it. Admin access never yields submitter identity, because none is ever stored (unlike Managed Surveys, where "admin ≠ raw-response access" concerns *content*; here it concerns *identity*, which doesn't exist to access). |
| 9 | Disabled-team behavior | A | BR-7 (submission blocked), BR-14 (viewing/management continue) — mirrors Managed Surveys' "Team disable semantics" exactly, adapted to this feature's simpler (no-transaction) write path. |
| 10 | Cross-team corruption | A | BR-10, BR-21 — every read/management operation re-derives and cross-checks `teamId` against the caller's trusted route scope. |
| 11 | Malformed persisted records | A | BR-15 — a domain-level `isValidChallenge` fail-closed validator excludes a malformed record from any listing rather than trusting or crashing on it. |
| 12 | Logging plaintext challenge text | A | BR-25 — reiterates the existing project-wide invariant (`docs/SECURITY.md` #14, `.claude/rules/security.md`) for this feature's specific operations. |
| 13 | Encryption failures | A | Reuses `src/lib/encryption/encryption.ts` unchanged — fails closed (throws) on a missing/invalid key or corrupt payload; a per-record decryption failure excludes that one record from a list response rather than failing the whole request (BR-15) or falling back to plaintext. |
| 14 | Submission retries | C | With no dedup mechanism at all (see "Why no participation record"), a network retry simply creates an independent, indistinguishable second challenge — an explicitly accepted posture, identical in spirit to Managed Surveys' `public`-mode BR-23. |
| 15 | Duplicate submissions | C | Same as above — explicitly allowed, not detected, by design (BR-8). |
| 16 | Timing correlation | B | See #3 above. |
| 17 | Free text containing personal/sensitive information (about the submitter or a named colleague) | C/D | Cannot be architecturally prevented — a submitter could type any content, including names. Mitigated only at the copy level: the submission UI explicitly instructs against including names or identifying details (BR-28). No automated PII scanning/redaction exists or is planned for v1 (explicit non-goal); a future hardening option (D) if this proves to be a real problem in practice. |
| 18 | Deletion/archive semantics | A | BR-17-BR-20 — explicit, precise lifecycle rules; no ambiguity about what each transition does to visibility vs. underlying data. |
| 19 | Raw datastore/console access | B | An operator with direct Admin SDK/console access sees ciphertext, not plaintext, unless they also hold the separately-protected `ENCRYPTION_KEY` — the same server-only trust boundary this entire application already accepts (`docs/ARCHITECTURE.md`). Even with full decrypt access, there is still no identity field to recover — a strictly narrower exposure than a hypothetical identity-carrying design would have. |
| 20 | Public vs. authenticated submission abuse | C | No public mode exists (Non-goals) — the classic anonymous-link abuse surface Managed Surveys must accept for `public` surveys does not apply here at all. Residual: an authenticated real member could submit excessive junk to their own team's list; no rate limiting is built in v1 (explicit Non-goal), mirroring Managed Surveys' own choice not to build anti-abuse tooling in its first phase. |

**Auditability without destroying anonymity.** This concern is entirely
about *admin* accountability (who resolved/archived a challenge), never
about submitter identity (which doesn't exist to audit). `resolvedBy`/
`archivedBy` (the acting admin's `uid`) are persisted on the challenge
document for this purpose, but are **deliberately never returned** by any
API response in v1 (BR-13) — a conscious minimization choice, easy to
expose later (e.g., in the admin UI) without a schema change if a real need
arises. `deleteChallenge` leaves no persisted trace at all beyond ordinary,
content-free server request logs (see Non-goals — no structured deletion
audit log in v1).

## Data model
One new collection, matching this codebase's existing "server-only,
Admin-SDK-only, deny-all client rule, opaque generated ID" pattern used by
`surveys`/`surveyResponses`:

```
challenges/{challengeId}
    teamId: string
    ciphertext: string
    iv: string
    authTag: string
    keyVersion: "v1"
    submittedAt: Timestamp
    resolvedAt?: Timestamp
    resolvedBy?: string   // acting admin's uid; persisted for internal
                          // accountability only, never returned by any API
                          // response in v1 (see "Auditability" above)
    archivedAt?: Timestamp
    archivedBy?: string   // same posture as resolvedBy
```

**No other collection is introduced.** Evaluated and rejected:
- **`ChallengeSubmission`** (separate from `Challenge`): Managed Surveys
  needed `SurveyResponse` + `SurveyParticipation` as two documents
  specifically to support a dedup check with no shared identifier between
  them. This feature has no dedup requirement (see "Why no participation
  record"), so there is nothing for a second document to separate out —
  one `challenges` document per submission is both the submission record
  and the thing displayed.
- **`ChallengeManagementState`**: Managed Surveys' `teamSurveyState`
  exists to race-safely enforce "at most one open survey per team." There
  is no analogous "at most one" invariant for challenges — many can be
  `open` for the same team simultaneously, which is the normal, expected
  case — so no coordination document is needed.
- **`ChallengeCategory`**: no categories exist in v1 (Non-goals).

`challengeId` is a Firestore auto-generated document ID (`.add()`), exactly
like `surveyResponses/{responseId}` — never client-supplied, never
deterministic, never derived from `teamId`/`uid`/content.

## Lifecycle
Two independent optional timestamps, from which a status is always derived
— never a separately stored status field (same principle as
`effectiveLifecycle` for surveys, `docs/features/managed-surveys/SPEC.md`):

```
effectiveChallengeStatus(challenge) =
    "archived"  if challenge.archivedAt is set
    "resolved"  else if challenge.resolvedAt is set
    "open"      otherwise
```

| State | Reached by | Who | Reversible? | Text still visible? |
|---|---|---|---|---|
| `open` | Submission (`submitChallenge`) | Any real team member | N/A (initial state) | Yes |
| `resolved` | `resolveChallenge` on an `open` challenge | App admin only | No (terminal; calling again is a no-op; not reachable from `archived`) | Yes |
| `archived` | `archiveChallenge` on an `open` **or** `resolved` challenge | App admin only | No (terminal; no "unarchive" action exists) | Yes — archiving only removes the challenge from the default/active list, never from underlying storage or from an authorized viewer's ability to see it if a future surface chose to show archived items |
| *(deleted)* | `deleteChallenge`, on a challenge in **any** status | App admin only | No — permanent Firestore document removal | N/A — content no longer exists |

- **Disabled-team interaction**: none of `resolveChallenge`/
  `archiveChallenge`/`deleteChallenge` is gated on the owning team's
  `active` status (BR-22) — administrative cleanup remains possible on a
  disabled team. Only *submission* (a new challenge being created) is
  blocked for a disabled team (BR-7).
- **Persisted fields per transition**: `resolveChallenge` sets
  `resolvedAt`/`resolvedBy`; `archiveChallenge` sets `archivedAt`/
  `archivedBy`; neither ever touches the other transition's fields (a
  challenge archived directly from `open` has `resolvedAt` left unset,
  which is fine — `effectiveChallengeStatus` only asks "is `archivedAt`
  set," never "was it resolved first").
- **Idempotency**: `resolveChallenge` on an already-`resolved` challenge is
  a no-op (no error, no field rewrite); on an `archived` challenge it is
  rejected (`not_open`) — resolving something already archived would be a
  backwards, contradicting transition. `archiveChallenge` on an already-
  `archived` challenge is a no-op.

## Server operations
All server-only (`"server-only"` import, Firebase Admin SDK), following
`src/features/surveys/server/`'s established pattern of one function per
operation with an injectable dependency seam for testing. Unlike several
survey operations, **none of these requires a Firestore transaction** —
each is a single-document read-then-write with no cross-document invariant
to protect against a race (no coordination document, no paired
participation write), so a plain read immediately followed by a write is
sufficient, mirroring `createSurvey`'s (not `openSurvey`'s) simpler
plain-read pattern.

- **`submitChallenge(idToken, teamId, text)`**
  - Verify the ID token (`verifyIdToken`) → reject `sign_in_required` if
    absent/invalid.
  - Validate `text` (`validateChallengeText`: non-empty after trim, 3-2000
    characters) → reject `invalid_input`, nothing read or written yet.
  - Check a real `teamMemberships/{uid}__{teamId}` record exists (BR-1) →
    reject `forbidden` if not (an app admin with no such record included).
  - Re-read `teams/{teamId}.status` fresh → reject `team_disabled`/
    `team_not_found` if not `active` (BR-7).
  - Encrypt `text` server-side (fresh IV) → persist `challenges/{auto-id}`:
    `{teamId, ciphertext, iv, authTag, keyVersion, submittedAt: now}` — no
    other field.
  - Return only success/failure — no generated `challengeId`, no echoed
    text (mirrors `submitSurveyResponse`'s response-minimization posture).
  - Fail-closed on any Firestore read/write error → `persistence_failed`,
    no partial state (a single `.add()` is atomic by itself).

- **`listTeamChallengesForMember(idToken, teamId)`** and
  **`listTeamChallengesForAdmin(idToken, teamId)`** — two public
  operations, sharing one internal, unexported helper so decryption/
  validation logic is not duplicated (`fetchTeamChallenges(teamId,
  allowedStatuses, deps)` — illustrative name; not itself a public
  operation or a BR, purely an implementation-organization detail):
  - `listTeamChallengesForMember`: `authorizeTeamAccess(identity, teamId)`
    → `"admin"` or `"member"` required; `"denied"` → `forbidden`; a
    `read_failed` result from the authorization check itself is never
    collapsed into `forbidden`. On success, calls the shared helper with
    `allowedStatuses = ["open", "resolved"]` — fixed by this operation,
    never by anything the caller supplies.
  - `listTeamChallengesForAdmin`: `requireAppAdmin` required; a non-admin
    (including an otherwise-authorized team member) is rejected. On
    success, calls the shared helper with `allowedStatuses = ["open",
    "resolved", "archived"]`.
  - Neither operation reads `teams/{teamId}.status` (no team-`active` gate
    on either read — BR-14).
  - **Shared helper, in this exact order** (the order itself is the privacy
    guarantee — BR-37): query `challenges` where `teamId == teamId`
    (single-field, no composite index — BR-24, see "Firestore/rules/index
    implications" for why this is provably sufficient) → for each raw
    document, validate via `isValidChallenge` (fail-closed — skip, don't
    throw, on a malformed record) → compute `effectiveChallengeStatus` from
    the now-validated `resolvedAt`/`archivedAt` fields *(this step needs no
    decryption at all — status is derived purely from two timestamp
    fields)* → **exclude any record whose status is not in the caller's
    `allowedStatuses`, before touching `ciphertext`** — an excluded
    record's `ciphertext` is never passed to `decrypt`, so its plaintext is
    never computed at all, let alone returned, by either operation → only
    then decrypt the surviving records' `ciphertext` (skip, don't throw or
    fall back to ciphertext, on a decryption failure — BR-15) → map each to
    the response DTO `{challengeId, text, status, submittedAt: <date
    only>}` — never `resolvedBy`/`archivedBy`/`resolvedAt`/`archivedAt`
    (BR-13), never the encrypted fields (`ciphertext`/`iv`/`authTag`/
    `keyVersion`).
  - Sort newest-first in application code, after filtering (matches the
    existing fetch-by-single-field-then-sort-in-code convention already
    used for survey history — no composite index needed for ordering
    either).

- **`resolveChallenge(idToken, teamId, challengeId)`** (admin-only)
  - `requireAppAdmin` → reject otherwise.
  - Fetch + validate the target `challenges/{challengeId}`; missing/
    malformed → `not_found`.
  - Confirm `challenge.teamId === teamId` (route scope) → `wrong_team`
    otherwise.
  - `effectiveChallengeStatus` → `"archived"` → reject `not_open`;
    `"resolved"` → no-op success; `"open"` → set `resolvedAt = now`,
    `resolvedBy = caller uid`.

- **`archiveChallenge(idToken, teamId, challengeId)`** (admin-only)
  - Same admin/fetch/team-match checks as above.
  - `"archived"` → no-op success; `"open"`/`"resolved"` → set
    `archivedAt = now`, `archivedBy = caller uid`.

- **`deleteChallenge(idToken, teamId, challengeId)`** (admin-only)
  - Same admin/fetch/team-match checks as above.
  - Any status → permanently delete the document. No response-count-style
    precondition (unlike survey delete) — see "Lifecycle" table.

Error contracts follow this codebase's existing convention throughout
`src/features/teams/server/` and `src/features/surveys/server/`: a
discriminated result type distinguishing a genuine authorization/validation
outcome from `{ok: false, error: "read_failed" | "persistence_failed"}` for
an infrastructure failure — the caller must never treat an infrastructure
failure as a `denied`/`forbidden` decision, or vice versa.

## UI/UX
- **`/teams/[teamId]`** gains an "Utfordringer" section, visible to an
  authorized member/admin (the existing non-member "request access" state
  is unaffected and still shown to a non-member instead of any challenge
  content):
  - A submission panel: a labeled textarea, a submit button, and Norwegian
    copy explaining the guarantee accurately and warning against including
    identifying details, e.g.:
    > **Meld en utfordring**
    > Del noe som gjør arbeidet vanskeligere, skaper friksjon, eller bør bli
    > bedre. Innsendingen er anonym — vi lagrer ikke hvem som sendte den
    > inn. Ikke inkluder navn eller annen informasjon som kan identifisere
    > deg eller andre.
    Exact final wording lives in a copy module (`src/features/challenges/
    copy.ts`), following the established convention (`docs/features/
    product-ux-shell/SPEC.md` BR-2), not hardcoded inline.
  - A read-only list of the team's `open`/`resolved` challenges (text,
    Norwegian status label, submission date), fetched via
    `listTeamChallengesForMember` — the server itself never includes an
    `archived` challenge in this response (BR-9), so this component has no
    archived-filtering logic of its own to implement; it renders exactly
    what it received.
  - Disabled team: the submission panel is hidden/disabled (mirrors the
    survey creation restriction); the existing challenge list remains
    visible (BR-14).
- **`/admin/teams/[teamId]`** gains an "Utfordringer" management section,
  fetched via `listTeamChallengesForAdmin` — a **different** server
  operation than the team page uses, not the same response re-grouped: the
  returned set already includes every status (`open`/`resolved`/
  `archived`); this component's active/archived grouping is a pure
  presentation split of an already-fully-eligible, already-decrypted
  response, never a privacy boundary. Per-row action buttons: "Marker som
  løst" (resolve), "Arkiver" (archive), "Slett" (delete, with an explicit
  confirmation step before it actually executes — mirrors the existing
  admin destructive-action confirmation pattern already used for surveys/
  team members).
- Internal/technical values (`open`, `resolved`, `archived`) are never
  shown — every surface uses Norwegian labels (BR-29).
- Reuses existing shared primitives (`Button`, `Card`, `Alert`,
  `EmptyState`, `LoadingState`, `PageHeader`) and the shared
  `useAuthGatedResource` hook — no new component system
  (`.claude/rules/architecture.md`, `docs/UI-UX.md`).
- States required, per screen, per `docs/UI-UX.md`'s existing convention:
  loading, empty ("no challenges yet"), success (submission confirmation),
  validation error (textarea too short/long), authorization failure (the
  existing non-member/non-admin generic states, unchanged), infrastructure
  failure. Admin per-row actions get their own pending/error state,
  mirroring the existing `AdminTeamDetail` per-row pattern.
- Accessibility: the textarea has a real associated `<label>`; every admin
  action button is keyboard-operable with a visible focus state; status is
  never conveyed by color alone (paired with Norwegian text), consistent
  with `docs/UI-UX.md`.
- Responsive: works at common phone widths (~360-400px), consistent with
  every other screen in this application.
- No comment, voting, reaction, notification, tag/category, or
  gamification pattern is introduced anywhere (Non-goals, and unchanged
  `docs/PRODUCT.md` non-goal against individual-performance patterns).

## Team-disable semantics
Mirrors Managed Surveys' "Team disable semantics" exactly, adapted to this
feature's simpler (non-transactional) write path:

- **Submission** (BR-7): `submitChallenge` re-reads `teams/{teamId}.status`
  immediately before persisting; a `disabled` (or missing/malformed) status
  is rejected identically. There is no multi-document invariant here to
  protect with a transaction (unlike survey submission's paired
  `SurveyResponse`/`SurveyParticipation` write), so a plain fresh read
  immediately before the single `.add()` closes the same "disabled while
  submitting" race window `createSurvey`'s equivalent plain-read pattern
  already accepts as sufficient for a single-document write.
- **Reading** (BR-14): unaffected for both `listTeamChallengesForMember`
  and `listTeamChallengesForAdmin` — a disabled team's existing challenges
  (whichever status subset each operation is scoped to) remain visible to
  its existing members/admins, exactly like a disabled team's existing
  survey results (`docs/features/team-management/SPEC.md` BR-3,
  `docs/features/managed-surveys/SPEC.md` "Results/history are
  unaffected").
- **Management** (BR-22): unaffected — resolve/archive/delete work
  regardless of the owning team's status, mirroring `closeSurvey`'s
  explicit "closing is neither opening nor answering" precedent.
- **Re-enabling a team** later simply restores answerability for new
  challenges; it never rewrites any challenge's stored lifecycle state
  (nothing to restore — challenge lifecycle was never touched by the
  disable in the first place).

## Firestore/rules/index implications
- New collection: `challenges/{challengeId}` — see "Data model" for the
  exact shape.
- `firestore.rules`: add
  ```
  match /challenges/{document=**} {
    allow read, write: if false;
  }
  ```
  identical in form and rationale to every existing collection's block
  (server-only Admin SDK access; this rule is documentation/defense-in-
  depth, not the primary enforcement mechanism).
- `firestore.indexes.json`: **no new entry — verified against the actual
  query shape, not assumed.** Both `listTeamChallengesForMember` and
  `listTeamChallengesForAdmin` issue the exact same Firestore-level query:
  `challenges` where `teamId == teamId` — a single equality filter, nothing
  else. This is not merely "avoiding" a composite index by convention; a
  composite index is architecturally impossible to need here, because
  `status` is a **derived** value (`effectiveChallengeStatus`, computed
  from `resolvedAt`/`archivedAt`) and is never itself a stored/queryable
  field on the document (see "Lifecycle") — there is no `status` field for
  a second Firestore-level clause (`status == "open"`, `status in [...]`,
  etc.) to exist against in the first place, so the classic composite-index
  trigger (`teamId == X AND <second field> == Y`, or `orderBy` on a second
  field) cannot arise from this schema. The two operations' different
  visibility is entirely a post-query, application-code filter over the
  results of this one identical query (see "Server operations" — the
  shared helper's exact ordering), applied **before** decryption and DTO
  construction, which is what makes it privacy-safe: the filtering happens
  entirely server-side, before any excluded record's plaintext is ever
  computed, let alone crosses to a client. Sorting (`submittedAt`
  descending) likewise happens in application code after filtering — the
  same established "fetch by one equality field, sort in code" pattern
  already used for survey-instance results/history.
  - **Considered and rejected**: denormalizing a stored `status` field
    onto `challenges` so eligibility could be expressed as a Firestore-level
    query clause. Rejected because it would reintroduce exactly the
    "separately stored status that could drift from its derivation" problem
    this feature's lifecycle model (mirroring `effectiveLifecycle` for
    surveys) was deliberately designed to avoid, for no privacy benefit —
    the current design already guarantees an ineligible record's plaintext
    is never computed, which is the actual guarantee that matters; a
    Firestore-level filter would only be a defense-in-depth nicety against
    a threat (a bug in the application-code filter step) that a thorough
    test suite (see "Testing strategy" — the critical member/archived
    regression test) already covers directly.
- No coordination document (unlike `teamSurveyState`) — there is no
  "at most one" invariant for challenges to enforce.

## Behavioral requirements

**Submission**
- **BR-1**: A caller can submit a challenge for `teamId` only if their
  verified identity holds an actual `teamMemberships/{uid}__{teamId}`
  record — app-admin status alone is never sufficient.
- **BR-2**: `submitChallenge` never accepts a client-supplied `challengeId`,
  `teamId` override, `status`, `resolvedAt`, or `archivedAt` — `teamId` is
  always the caller's trusted route scope; nothing beyond the free-text
  body is read from elsewhere in the request.
- **BR-3**: Challenge text must be non-empty after trimming and between 3
  and 2000 characters; any other input is rejected with nothing persisted.
- **BR-4**: On acceptance, the text is encrypted server-side (AES-256-GCM,
  fresh IV) before being written; the persisted document contains
  `teamId`, the encrypted payload and its decryption metadata, and
  `submittedAt` only — no identity field of any kind, for any submitter.
- **BR-5**: `challengeId` is a Firestore auto-generated, opaque document
  ID — never derived from `uid`, `teamId`, or the submitted text.
- **BR-6**: A challenge's status is always derived from `resolvedAt`/
  `archivedAt` (archived takes precedence over resolved, resolved over
  open) — never a separately stored status field that could drift.
- **BR-7**: Submitting to a `disabled` (or nonexistent, or status-malformed)
  team is rejected, re-checked fresh at submission time.
- **BR-8**: No duplicate-submission detection of any kind exists; the same
  identity may submit any number of challenges to the same team, and all
  succeed independently.

**Reading**
- **BR-9**: `listTeamChallengesForMember(teamId)` requires
  `authorizeTeamAccess` to resolve to `"admin"` or `"member"` for that
  `teamId`; `"denied"` is rejected. It returns only challenges whose
  derived status is `open` or `resolved` — an `archived` challenge is
  never included in this operation's response, for any caller, regardless
  of role. Backs `/teams/[teamId]`'s team-facing section.
- **BR-10**: A caller authorized for Team A cannot receive Team B's
  challenges from either read operation (`listTeamChallengesForMember` or
  `listTeamChallengesForAdmin`) merely by supplying Team B's `teamId`.
- **BR-11**: The DTO returned by either read operation never includes
  `uid`, `email`, `displayName`, or any other identity field, for any
  submitter, under any circumstance.
- **BR-12**: The DTO returned by either read operation exposes decrypted
  text, derived status, and the submission **date** only — the exact
  time-of-day component of `submittedAt` is never included in any
  client-facing response from either operation.
- **BR-13**: `resolvedAt`, `resolvedBy`, `archivedAt`, and `archivedBy` are
  all persisted but never returned by either read operation's API response
  in v1 — a viewer (member or admin) sees only that a challenge's derived
  status is `resolved`/`archived`, never when or by whom.
- **BR-14**: Viewing a disabled team's existing challenges — via either
  read operation — remains available to that team's existing
  members/admins, unaffected by the team's `disabled` status.
- **BR-15**: A challenge document that fails `isValidChallenge` validation,
  or whose ciphertext fails to decrypt, is silently excluded from either
  operation's returned list — it never causes the whole call to fail, and
  is never logged with any identity or content detail.

**Reading — actor-specific visibility** (added in planning-review response;
numbered BR-35+ rather than inserted between BR-15/BR-16, following the
same non-renumbering convention Managed Surveys used for its own
later-added BR-43-48 — see `docs/features/managed-surveys/SPEC.md`)
- **BR-35**: `listTeamChallengesForAdmin(teamId)` requires
  `requireAppAdmin` — a non-admin caller, including an otherwise-authorized
  team member, is rejected. It returns challenges of every derived status
  (`open`, `resolved`, `archived`) for that team. Backs
  `/admin/teams/[teamId]`'s management section only — never called from
  the team-facing page, regardless of the caller's own role.
- **BR-36**: Which statuses a read operation may return is fixed by that
  operation's own server-side authorization outcome and never accepted
  from, or influenced by, any client-supplied parameter — neither
  `listTeamChallengesForMember` nor `listTeamChallengesForAdmin` accepts an
  `includeArchived`-shaped request field of any kind.
- **BR-37**: For both read operations, a challenge's derived status is
  evaluated — using only its already-validated `resolvedAt`/`archivedAt`
  fields, which requires no decryption — and any record whose status is
  outside the calling operation's allowed set is excluded **before** its
  `ciphertext` is passed to the decryption step. An excluded record's
  plaintext is never computed by either operation, let alone included in a
  response — the exclusion is enforced entirely server-side, never by
  client-side rendering logic.

**Lifecycle / management**
- **BR-16**: Only an app admin (`requireAppAdmin`) may resolve, archive, or
  delete a challenge — never a plain member, even of their own team.
- **BR-17**: `resolveChallenge` transitions an `open` challenge to
  `resolved` (`resolvedAt`/`resolvedBy` set to now/caller); calling it on
  an already-`resolved` challenge is a no-op; calling it on an `archived`
  challenge is rejected (`not_open`).
- **BR-18**: `archiveChallenge` transitions an `open` or `resolved`
  challenge to `archived` (`archivedAt`/`archivedBy` set to now/caller);
  calling it on an already-`archived` challenge is a no-op.
- **BR-19**: No "un-resolve" or "un-archive" action exists anywhere in this
  feature — both transitions are terminal.
- **BR-20**: `deleteChallenge` permanently removes the target document
  regardless of its current status; there is no response-count-style
  precondition (unlike survey delete), since a challenge document is
  itself the only content that could ever be lost, and there is no
  companion record it could orphan.
- **BR-21**: Every management operation re-verifies the target challenge's
  own persisted `teamId` equals the caller's route-scoped `teamId`; a
  mismatch is rejected (`wrong_team`), never silently acted on.
- **BR-22**: Resolve/archive/delete are permitted regardless of the owning
  team's `active`/`disabled` status — only new submissions are blocked by
  a disabled team (BR-7).

**Firestore / infrastructure**
- **BR-23**: `challenges` has an explicit client-SDK deny-all block in
  `firestore.rules`, identical in form to every existing collection's
  block; all access happens server-side via the Firebase Admin SDK.
- **BR-24**: Both `listTeamChallengesForMember` and
  `listTeamChallengesForAdmin` query `challenges` by `teamId` alone
  (single-field, auto-indexed) — the identical query for both operations,
  differing only in the application-code status filter applied to its
  results (BR-35-BR-37); no new composite index is introduced.

**Logging**
- **BR-25**: No operation in this feature logs challenge plaintext,
  ciphertext, or any decrypted value, on any success or failure path.
- **BR-26**: A log line may reference a `uid` alone, or a `challengeId`
  alone, but never both together in the same entry.

**UI**
- **BR-27**: `/teams/[teamId]` shows the submission panel only to an
  authorized real team member (never a non-member or signed-out visitor)
  and the read-only open/resolved challenge list (via
  `listTeamChallengesForMember`, BR-9) to any member or admin.
- **BR-28**: The submission UI's Norwegian copy states the anonymity
  guarantee accurately (never more strongly than the architecture
  supports) and instructs the submitter not to include names or other
  identifying information.
- **BR-29**: Internal/technical status/lifecycle values are never shown to
  a user — every surface uses Norwegian, non-technical labels.
- **BR-30**: `/admin/teams/[teamId]` lists the team's challenges (via
  `listTeamChallengesForAdmin`, BR-35 — active + archived sections) with
  resolve/archive/delete actions; the delete action requires an explicit
  confirmation step before it executes.
- **BR-31**: No comment, voting, reaction, notification,
  categorization/tag, or AI-classification feature exists anywhere in this
  UI.
- **BR-32**: The submission textarea has a real associated label and a
  visible validation-error state; every admin action button is
  keyboard-operable with a visible focus state.

**Cross-feature clarity**
- **BR-33**: The server never accepts a client-supplied `challengeId`,
  status, or lifecycle timestamp when creating a challenge.
- **BR-34**: Challenge text is individually visible to any authorized
  viewer once submitted — it is never aggregated or suppressed by a
  response-count threshold (explicit, deliberate distinction from Managed
  Surveys' aggregation model — see "Privacy/anonymity model").

## Edge cases and failure behavior
- A team is disabled while a member has the submission panel open → the
  panel's own earlier render is unaffected, but the next submit attempt is
  rejected fresh (mirrors the existing "team disabled while viewing/
  submitting" precedent throughout this codebase).
- A challenge is archived while an admin has the management list open →
  their current view is unaffected; their next request reflects the
  archived state (existing pattern, `docs/features/team-management/
  SPEC.md`).
- Two admins attempt to resolve the same `open` challenge at nearly the
  same time → **both calls succeed and the derived `status` is correctly
  `resolved` either way — but this is not a true no-op race.** Corrected
  in this planning-review response: with no transaction, both calls can
  read `"open"` before either commits, so both proceed to write, and
  Firestore's plain (non-transactional) `update()` resolves the conflict
  as ordinary last-writer-wins on the fields touched (`resolvedAt`/
  `resolvedBy`). The *status* outcome is deterministic (both writes move
  the same document toward `"resolved"`, so which one "wins" doesn't
  change what any reader sees), but the *`resolvedBy`/`resolvedAt` audit
  values* are not — whichever admin's write physically lands last is the
  one recorded, which may not be the admin a human would consider to have
  "actually" resolved it first. This is accepted as a residual risk (see
  "Accepted residual risks" — item 7), not fixed with a transaction: these
  fields are never returned by any API response in v1 (BR-13), so the only
  consequence is a possible future accuracy question for an operator with
  direct Firestore access, not a privacy or correctness-of-status
  regression. The identical reasoning applies to `archiveChallenge`. A
  race between one admin's `resolveChallenge` and a different admin's
  `archiveChallenge` on the same challenge is not subject to this
  imprecision, since the two write disjoint field pairs
  (`resolvedAt`/`resolvedBy` vs. `archivedAt`/`archivedBy`) — both commit,
  and `effectiveChallengeStatus` deterministically resolves to `"archived"`
  (archived takes precedence, per "Lifecycle").
- A malformed persisted challenge (e.g. missing `submittedAt`) is present
  in Firestore (e.g. from a future bug or manual console edit an operator
  should not have made) → excluded from both `listTeamChallengesForMember`
  and `listTeamChallengesForAdmin` (BR-15),
  never crashes the request, never returned to any admin action either
  (an admin action re-validates the same way on fetch, so a malformed
  document also can't be resolved/archived/deleted through the normal
  operation — an operator would need direct Firestore console access to
  remove it, which is outside this application's own trust boundary
  either way).
- A submission's encryption call throws (e.g. missing `ENCRYPTION_KEY`) →
  the submission fails closed with a generic infrastructure-failure
  response; nothing is persisted, and the thrown error (which could
  reference key material) is never logged verbatim.

## Security and privacy
See "Privacy/anonymity model" above for the full threat model; this section
cross-references `docs/SECURITY.md` explicitly rather than restating it:
- Invariants 1/3/4/5 (application-level encryption, server-side only, keys
  never leave the server): unchanged mechanism, reused as-is (BR-4).
- Invariant 6 (no identity in anonymous responses): BR-4, BR-11.
- Invariant 7 (participation/auth records stored separately from response
  data): satisfied trivially — there is no participation record at all for
  this feature (see "Why no participation record").
- Invariants 8/9 (server-side team authorization, no cross-team leakage):
  BR-1, BR-9, BR-10, BR-21, BR-35.
- Invariant 13 (anonymous free-text challenges are highly sensitive): this
  entire feature exists to implement that invariant correctly for the
  first time in this codebase.
- Invariant 14 (no sensitive content in logs): BR-25/BR-26.
- Invariant 16 (data minimization and retention considered from the
  start): addressed by minimizing the persisted schema (no identity field,
  `resolvedBy`/`archivedBy` never exposed) and by explicitly flagging
  retention duration as an open product question rather than silently
  assuming indefinite retention is fine (see "Open questions").
- Invariant 17 (admin access ≠ automatic raw-identity access): BR-11 — an
  app admin can read challenge *content* by design (BR-34, BR-35), including
  archived content a plain member never receives, but never gains
  submitter identity, because none is ever stored.
- No new external dependency, third-party service, or client-side tracking
  script is introduced.

## Accepted residual risks
(Consolidated from the "Privacy/anonymity model" threat-model table.)
1. Timing correlation from `submittedAt` + content, in a small team (B) —
   mitigated by exposing only the submission date, never time-of-day, to
   any client.
2. Raw Firestore/console access to ciphertext (B) — bounded by the same
   server-only trust boundary this entire application already accepts;
   even then, no identity field exists to recover.
3. Free text may contain identifying information the submitter chose to
   include, about themselves or someone else (C/D) — mitigated only by
   explicit UI copy; no automated scanning in v1.
4. Repeated/duplicate submissions from the same identity are accepted,
   undetected, by design (C).
5. A real team member submitting excessive junk content is undefended in
   v1 — no rate limiting (C).
6. `deleteChallenge` leaves no structured audit trail beyond ordinary,
   content-free server logs (C).
7. Concurrent `resolveChallenge` (or `archiveChallenge`) calls from two
   different admins on the same challenge can silently attribute
   `resolvedBy`/`resolvedAt` (or `archivedBy`/`archivedAt`) to whichever
   admin's write physically lands last, since no transaction serializes
   these single-document updates (C) — corrected/documented in this
   planning-review response; see "Edge cases and failure behavior." The
   derived `status` itself is unaffected and remains correct either way;
   only the never-exposed (BR-13) audit-attribution fields carry this
   imprecision.

## Acceptance criteria
- [x] A real team member (not merely an app admin) can submit a challenge
      for their team; app-admin-only status is rejected.
- [x] The persisted `challenges` document never contains an identity field,
      under any code path.
- [x] A member or admin of a team can list that team's open/resolved
      challenges (via `listTeamChallengesForMember`) in decrypted,
      individually-visible form; a non-member/non-admin cannot.
- [x] An app admin can additionally list that team's archived challenges
      (via `listTeamChallengesForAdmin`); a plain member calling this
      operation is rejected, and `listTeamChallengesForMember` never
      includes an archived challenge for any caller.
- [x] An archived challenge with distinctive plaintext, placed directly in
      storage, never appears anywhere in `listTeamChallengesForMember`'s
      serialized response — proving server-side exclusion, not merely that
      no UI renders it.
- [x] A caller authorized for Team A cannot list or manage Team B's
      challenges via a Team B `challengeId`.
- [x] An app admin can resolve, archive, and delete a challenge; a plain
      member cannot perform any of the three.
- [x] Resolve/archive are idempotent/terminal exactly as specified; delete
      is permanent and requires no response-count precondition.
- [x] Submitting to a disabled team is rejected; viewing and managing a
      disabled team's existing challenges continues to work.
- [x] `firestore.rules` denies client-SDK access to `challenges`; no new
      composite index is introduced.
- [x] No operation logs challenge plaintext/ciphertext, or a `uid` and
      `challengeId` together, on any path.
- [x] `/teams/[teamId]` and `/admin/teams/[teamId]` UI matches "UI/UX"
      above, in Norwegian, with the required interaction states.
- [x] Automated tests cover every category in "Testing strategy," below.

## Testing strategy
| Boundary | Covers |
|---|---|
| Domain validators (`validateChallengeText`, `isValidChallenge`, `effectiveChallengeStatus`) | BR-3, BR-6, BR-15 |
| `submitChallenge` server tests | BR-1, BR-2, BR-4, BR-5, BR-7, BR-8 — including: real-member success; app-admin-without-membership rejection; disabled-team rejection; malformed/oversized/empty text rejection; encryption-failure fail-closed; no identity field in the persisted document (explicit negative assertion); repeated submissions from the same uid all succeed independently |
| `listTeamChallengesForMember` server tests | BR-9-BR-15, BR-36, BR-37 — including: member success (each member-visible status — `open` and `resolved` — is returned); admin success (same member-scoped result when reading via the team page); non-member/non-admin rejection; cross-team rejection (Team A identity cannot list Team B); disabled-team viewing continuity; a malformed record excluded without failing the whole call; a decryption-failure record excluded the same way; returned DTO never contains `uid`/`resolvedBy`/`archivedBy`/`resolvedAt`/`archivedAt`/exact submission time/encrypted fields; a request-body `includeArchived`-shaped field is ignored, not honored |
| **Critical regression test**: an `archived` challenge with distinctive, easily-greppable plaintext (e.g. `"ARCHIVED-CANARY-<random>"`) is placed directly in the fake/test Firestore store; `listTeamChallengesForMember`'s full serialized response is asserted to contain neither that plaintext nor the record's `challengeId` anywhere — proving the exclusion happens before decryption/DTO construction, not merely that no UI renders it | BR-9, BR-37 |
| `listTeamChallengesForAdmin` server tests | BR-35, BR-36, BR-37 — including: admin success returning exactly `open`+`resolved`+`archived` (all three, in one call); non-admin (including a plain team member) rejection; wrong-team/cross-team exclusion; disabled-team viewing continuity; malformed/decryption-failure record excluded the same way as the member operation; returned DTO never contains `uid`/`resolvedBy`/`archivedBy`/`resolvedAt`/`archivedAt`/encrypted fields |
| `resolveChallenge`/`archiveChallenge`/`deleteChallenge` server tests | BR-16-BR-22 — including: admin success for each; non-admin rejection for each; wrong-team rejection; idempotent resolve/archive; resolve-on-archived rejection; delete works regardless of status; all three work on a disabled team's challenge |
| Firestore rules/config assertions | BR-23, BR-24 — a static assertion (mirroring `firestore-deployment-config.test.ts`'s existing pattern) that `challenges` carries the deny-all block; a check that no new composite index was added for this feature |
| Logging assertions | BR-25, BR-26 — spy on console/logging output across every success and failure path in every operation above, asserting no challenge text/ciphertext appears, and no log entry contains both a `uid` and a `challengeId` |
| API route tests | Thin route handlers delegating to the server operations above — auth/session wiring, status-code mapping, and that route params are never trusted over the server-derived team/identity checks |
| Gateway (client fetch wrapper) shape-validation tests | Mirrors `src/features/surveys/client/*-gateway.test.ts` — malformed/unexpected server response shapes are rejected client-side rather than rendered as if valid |
| Component tests | Submission form (validation, submit/success/error states, loading), team-page challenge list (empty/loaded/error), admin management section (per-row actions, confirmation step for delete, active/archived grouping) |
| Privacy regression tests | A dedicated test asserting the full serialized shape of every response type in this feature (submit result, list item, management result) never contains an identity-shaped key, run against the actual TypeScript types/DTOs, not just spot-checked example values |

## Open questions
1. **Retention duration for resolved/archived challenges.** This spec
   defaults to indefinite retention — an admin's only removal lever is the
   explicit `deleteChallenge` action; there is no automatic expiry or
   background cleanup job (consistent with this codebase's existing
   "no background jobs" architecture). Given `docs/SECURITY.md` invariant
   16 ("data minimization and retention are considered from the
   beginning"), this default should be explicitly confirmed (or replaced
   with a concrete retention policy) before or during implementation,
   rather than left as an implicit assumption. Recommended: confirm
   indefinite-until-manually-deleted as acceptable for v1, matching how
   every other collection in this codebase (teams, memberships, survey
   results) is already retained indefinitely today.

All other decisions in this document (rejecting a public submission mode,
rejecting an "acknowledged" state, rejecting categories, the specific
3-2000 character bounds, no rate limiting, no structured deletion audit
log) are treated as resolved product/architecture decisions for v1, made
under the brief's explicit "prefer the smallest useful v1" and "avoid
speculative features" guidance — not open questions — with rationale
recorded inline above and in "Non-goals" so they can be revisited
deliberately, not rediscovered as an oversight.
