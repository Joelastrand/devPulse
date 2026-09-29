# Demo Team

## Status
Approved — all design questions are resolved (none open). The Firebase
target project is **not** a design question: it is a mandatory *execution
gate* (see "Target-project safety model" and BR-4) that no planning document
pre-approves. Runtime has an explicit stop-for-approval fallback gate
(BR-32).

## Problem
DevPulse's value (results/trend, managed surveys, challenges, skill
progress and the progression path) is hard to show or explore on an empty
Firestore project: results need ≥ `minimumResponses` encrypted responses per
closed survey, trends need several closed periods, and skill paths need trees
plus tracking. Hand-building this through the UI is slow and not repeatable.

## User outcome
A presenter (a real team member; also an app admin if admin surfaces are to
be shown) can run one explicit, reviewed command against an explicitly named
Firebase project and get a small, fictional, clearly identifiable "Demoteam"
that makes every existing surface look alive — without changing product
behavior and without being able to damage any non-demo record.

## Scope
- A seed tool that writes one deterministic synthetic dataset for team id
  `demo-team` (team, presenter membership, surveys + encrypted responses,
  challenges, org-wide demo skill trees + team-level progress).
- Default-safe execution: dry-run by default, explicit project targeting,
  explicit write confirmation, fail-closed preflight, conflict-abort.
- Tests with injected fakes (no live Firebase) and dev documentation.

## Out of scope
Forum data; production/real data import or anonymized copies; creating or
changing Auth users, passwords or credentials; editing `APP_ADMIN_EMAILS` or
any application environment config; email sending; invitations or access
requests; any delete/reset/wipe capability; schema, index, rules, API or UI
changes; new product behavior; individual skill/performance data;
gamification changes; deployment; staging/production infrastructure
invention; Phase 10; Performance Phase B.

## Key concepts
- **Manifest**: the explicit, deterministic list of exact document paths the
  seed owns (BR-20). **The manifest is the ownership mechanism.**
- **Record class**: `C` (create-only: written only if absent) or `U` (upsert:
  `set()` to the fixture, converging to it).
- **Classification**: every manifest path is classified before any write as
  `ABSENT`, `COMPATIBLE` (existing demo-owned record) or `CONFLICT` (BR-23).
- **Audit actor constant**: `demo-seed`, used only where field semantics
  allow (BR-21).
- **as-of date**: a day-granular UTC date (`--as-of YYYY-MM-DD`, default:
  today UTC) from which every fixture timestamp is derived (BR-19).
- **Presenter**: the externally supplied, pre-existing Firebase Auth uid that
  becomes the demo team's only real member.

## Existing infrastructure findings (repository truth)
1. **No scripts/tools/seed infrastructure exists.** `package.json` scripts
   are only `dev`, `build`, `start`, `lint`, `typecheck`, `test`. The only
   existing seed is `seedLegacyTeams` (`src/features/teams/server/
   seed-legacy-teams.ts`), an app-admin-authenticated API operation creating
   four legacy team docs with literal ids — precedent that literal team
   document ids are valid.
2. **Admin SDK init** is `src/lib/firebase/admin.ts`: `import "server-only"`,
   `cert()` from the `FIREBASE_*` trio if all set, **otherwise
   `applicationDefault()`** (silent ambient-credential fallback — exactly what
   the seed must not inherit). Not reusable by a script as-is.
3. **Project selection** has independent representations, none authoritative
   for a script: `.firebaserc` (git-ignored, per-clone; the local copy
   currently names `devpulse-ac26e` as `default` — an *observed local
   reference only, not an approved target*), `FIREBASE_PROJECT_ID`,
   `NEXT_PUBLIC_FIREBASE_PROJECT_ID`. `firebase.json` has no project id and
   no emulators. The seed never reads `.firebaserc` or shells out to a CLI.
4. **No emulator support** and no destructive/reset script exists.
5. **Execution capability**: Node v24.20 runs `.ts` natively (type
   stripping); `tsx`/`ts-node` are **not** dependencies. Repo modules use
   extensionless relative imports (`moduleResolution: bundler`), which native
   Node cannot resolve; `server-only` throws under plain Node unless the
   `react-server` export condition is set. Verified locally (no Firebase,
   throwaway in-memory key): `node --conditions=react-server` can import
   `src/lib/encryption/encryption.ts` and pure domain validators by explicit
   `.ts` path and `encrypt`/`decrypt` round-trip works. Modules with
   extensionless imports (`aggregation.ts`, `server/` modules) are loadable
   by Vitest but not by native Node. `node --env-file=.env.local` works
   natively.
6. **Collections and validators** (Admin-SDK-only; rules deny clients):
   `teams` (persisted `{name, status, createdAt, createdBy}`; id is the team
   id), `teamMemberships/{uid}__{teamId}` (`isValidMembershipFor` checks only
   `uid`/`teamId`), `surveys` (`isValidSurvey`: `surveyId` field = doc id,
   `minimumResponses` ∈ [3,20]), `surveyResponses` (random id in prod; shape
   check only — `surveyId`, `teamId`, three payload strings, `keyVersion`),
   `challenges` (`isValidChallenge`: `challengeId` field = doc id,
   `keyVersion` `"v1"`, `resolvedAt`/`resolvedBy` and `archivedAt`/
   `archivedBy` present together or absent together), `skillTrees`
   (`isValidSkillTree`: `nodeId === node-${index}`, 2–20 nodes; optional
   `updatedAt`/`updatedBy` pair), `skillProgress/{teamId}__{treeId}`
   (`isValidSkillProgress`).
7. **Timestamps / lifecycle**: Firestore `Timestamp` via JS `Date`; readers
   coerce with `toDate()`. A survey's lifecycle is **derived, never stored**
   (`effectiveLifecycle`): `closed` if `closedAt` set (or `endAt` reached),
   else `open` if `openedAt` set, else `scheduled`. `startAt` never affects
   it. A survey with `closedAt` set is closed regardless of the wall clock,
   and a survey with neither `openedAt` nor `closedAt`/`endAt` stays
   `scheduled` forever. So **fixed or relative dates can never flip a demo
   survey's lifecycle**; dates only affect how recent the periods look.
8. **Encryption**: `encrypt(plaintext)` (AES-256-GCM, fresh 12-byte IV, key
   from `ENCRYPTION_KEY` at call time, throws if missing/invalid, returns
   `{ciphertext, iv, authTag, keyVersion: "v1"}`); `decrypt(payload)` returns
   the plaintext or throws. Survey responses encrypt
   `JSON.stringify([flow, stress, fun])` (integers 1–5); challenges encrypt
   the trimmed text (3–2000 chars). Results silently exclude an undecryptable
   response, so a **wrong key fails silently at read time**, not at write
   time.
9. **Results model**: `getTeamSurveyResults` takes the team's most recent
   **12 closed** surveys sorted by `closedAt`; each is `published` (candidate
   count and valid-decrypt count ≥ its own `minimumResponses`) or
   `insufficient`. Aggregation is untouched by this feature.
10. **One-open-survey rule** lives in `teamSurveyState/{teamId}` (open/close
    transactions only). The seed never touches it.
11. **Visibility**: `/teams` lists **every** `active` team to any signed-in
    user; `/admin/skills` and the cross-team overview list **all** org-wide
    skill trees to every app admin. Seeded demo data is therefore visible to
    all users/admins of the target project (operational warning, Residual
    risk 1).
12. **Actor fields are accountability strings, never resolved.** Repository
    search shows `createdBy`/`updatedBy`/`resolvedBy`/`archivedBy`/
    `grantedBy` are validated only as non-empty strings, written from the
    acting admin's uid, never passed to `getUser`, never used in an
    authorization decision. `getUser` is called only on membership/access-
    request **`uid`** keys.
13. **App-admin access** is decided from `APP_ADMIN_EMAILS` (comma-separated,
    read at call time) against the signed-in user's verified email. It is
    deployment configuration, not data.
14. **Env**: `.env.local.example` documents Admin credentials,
    `ENCRYPTION_KEY`, `APP_ADMIN_EMAILS`, `FEATURE_FORUM_ENABLED`. This
    feature adds **no** variable. `FEATURE_FORUM_ENABLED` is irrelevant.

## Target-project safety model
The tool proves its target instead of assuming it. **No project is approved
by any planning document.**

1. `--project <id>` is **always required**; there is no default, no
   allow-list, no hard-coded id, and no inference from `.firebaserc`, the
   Firebase CLI, `gcloud`, or ambient credentials. `applicationDefault()` is
   never used.
2. Credentials come **only** from the explicit trio `FIREBASE_PROJECT_ID` +
   `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, all present.
3. Consistency (fail closed on any mismatch): `--project` ==
   `FIREBASE_PROJECT_ID`; if `NEXT_PUBLIC_FIREBASE_PROJECT_ID` is set it must
   equal it; `FIREBASE_CLIENT_EMAIL` must end with
   `@<project>.iam.gserviceaccount.com`. The Admin app is initialized with
   that explicit `projectId`.
4. **Execution gate (sequence, BR-4):**
   1. offline dry-run (no network) → prints the resolved project id;
   2. online read-only dry-run → reports the **exact resolved project id**
      and the per-path plan;
   3. the coordinator explicitly approves **that exact project id**;
   4. only then the first `--write --confirm <id>`.
   `--confirm` matching `--project` is a typo guard, **not** approval. An
   agent never infers approval from an earlier step or from the fact that a
   project is the observed local one. `devpulse-ac26e` is only the currently
   observed local reference and carries no approval.
5. The dataset is visible to every user/admin of whatever project is chosen
   (finding 11); the online dry-run report repeats this as a warning.

## Presenter identity model
Minimum input: **`--presenter-uid <uid>`**. Email is not an input. The Auth
user must already exist: the online dry-run/write preflight calls `getUser(uid)`
purely as an **existence check** — not-found or any failure aborts; the
returned record is discarded (email never read into output, never stored).
The seed never creates/updates users, passwords or tokens.

The uid is used only as the key/`uid` of the presenter's `teamMemberships`
doc (which makes member surfaces — `canReportProgress`, challenge submission,
authenticated-survey submission — demonstrable). **The presenter must also be
an app admin to demo admin surfaces** (challenge resolve/archive, survey
open/close, skill-tree admin). That depends on the presenter's verified email
being in `APP_ADMIN_EMAILS` (finding 13). The seed **does not infer or check
this from the uid**, does not read the presenter's email, and does not edit
`APP_ADMIN_EMAILS` or any application environment; it prints a static
reminder that this is an external runtime/demo prerequisite. No fake members
or uids are created; the member list shows exactly one member.

## Synthetic-data policy
Everything is fictional and Norwegian-facing: no real people, employers or
customers, no real/example email addresses, no copied or anonymized
production data, no lorem ipsum or joke data (invariant 15). The demo team's
59 "anonymous" responses against one real member is an intentional demo
artifact, called out so it is not mistaken for a realistic small-team
anonymity property.

## Demo dataset — authoritative count: **82 documents**
| Collection | Ids | Class | Count |
|---|---|---|---|
| `teams` | `demo-team` | C | 1 |
| `teamMemberships` | `{presenterUid}__demo-team` | C | 1 |
| `surveys` (closed) | `demo-survey-01` … `demo-survey-08` | U | 8 |
| `surveys` (scheduled) | `demo-survey-next` | C | 1 |
| `surveyResponses` | `demo-response-s{NN}-r{MM}` | U | 59 |
| `challenges` | `demo-challenge-01` … `-05` | U | 5 |
| `skillTrees` | `demo-skill-testing`, `-delivery`, `-observability`, `-secure-dev` | U | 4 |
| `skillProgress` | `demo-team__demo-skill-{testing,delivery,observability}` | U | 3 |
| **Total** | | | **82** |

Reconciliation: 1 + 1 + (8 + 1) + 59 + 5 + 4 + 3 = **82**. Responses:
seven publishable periods × 8 = 56, plus one insufficient period × 3 = 3,
total **59**; periods 1, 2, 4, 5, 6, 7, 8 publish (7 × 8) and period 3 is
insufficient. **The scheduled survey `demo-survey-next` receives zero
responses**; no response is ever seeded into a scheduled or open period for
presentation. 82 ≪ the Firestore batch limit of 500 (asserted ≤ 400, BR-30).
Encrypted payloads: 59 responses + 5 challenges = 64.

### Team / membership fixture
`teams/demo-team`: `name: "Demoteam"`, `status: "active"`, `createdAt`
(as-of), `createdBy: "demo-seed"`. Membership: `{uid: presenterUid, teamId:
"demo-team", createdAt, createdVia: "admin_direct", grantedBy: "demo-seed"}`.
No invitation, access-request, `teamSurveyState`, `surveyParticipations` or
users document is written.

### Survey fixtures and timing (BR-19)
Eight closed surveys, `accessMode: "authenticated"`, `minimumResponses: 5`,
titles "Teampuls – sprint N", plus one scheduled survey `demo-survey-next`
("Teampuls – neste sprint", authenticated, min 5, no `openedAt`/`closedAt`,
zero responses) so an admin can open it live. It is class C because its
lifecycle is coupled to `teamSurveyState`, which the seed never owns.

**Date strategy — relative to `--as-of`, ids independent of dates.**
Let `asOf` be midnight UTC of the as-of date (default: today UTC). For
period `i` = 1…8:
`closedAt_i = asOf + 12h − 2d − (8 − i) × 14d`; `openedAt_i = closedAt_i −
7d`; `createdAt_i = openedAt_i − 1d`; no `startAt`/`endAt`/`archivedAt`.
`demo-survey-next.createdAt = asOf − 1d`. Response `r` of `n` in period `i`
(r = 1…n): `submittedAt = openedAt_i + floor(7d × r / (n + 1))`, strictly
between `openedAt` and `closedAt`. Team/membership `createdAt = asOf`.
Ids contain no date, so **a rerun on a later day produces the same document
ids and no duplicate periods**; class `U` records are converged to the fixture
dates for the new as-of (logical fixture dates *intentionally move forward* on
rerun, keeping the trend meaningful and "recent"), while class `C` records
keep their original dates. Rerunning with the same `--as-of` yields identical
logical content (ciphertext bytes differ, BR-22). Because lifecycle is derived
from stored timestamps only (finding 7), a stale demo can never silently
change survey state; the only effect of not re-running is that periods look
older. All eight closed surveys are within the 12-survey trend window.

### Historical response / trend fixtures
Per-period responses (`[flow, stress, fun]`, integers 1–5) generated by a
**pure, RNG-free** function from a fixed target table (sum exactly
`round(target × n)`, fixed spread so each dimension has ≥ 2 distinct values;
per-dimension mean within ±0.13 of target):

| Period | n | flow | stress | fun | Result |
|---|---|---|---|---|---|
| 1 | 8 | 3.1 | 3.9 | 3.0 | published |
| 2 | 8 | 3.2 | 3.8 | 3.2 | published |
| 3 | 3 | — | — | — | **insufficient** (3 < 5) |
| 4 | 8 | 3.4 | 3.5 | 3.3 | published |
| 5 | 8 | 3.6 | 3.3 | 3.5 | published |
| 6 | 8 | 3.5 | 3.2 | 3.6 | published |
| 7 | 8 | 3.8 | 2.9 | 3.7 | published |
| 8 | 8 | 3.9 | 2.7 | 3.9 | published |

Period 3 is **below the real aggregate threshold** (`candidates.length <
minimumResponses` in `computeSurveyAggregate`): it demonstrates suppression
with the production rules, no special-casing. The latest closed period (8) is
published. Response docs contain exactly `{surveyId, teamId, ciphertext, iv,
authTag, keyVersion, submittedAt}` — no identity field, no participation
record.

### Challenge fixtures
`demo-challenge-01…05` (`challengeId` field = doc id), `teamId: "demo-team"`,
synthetic workplace-process themes: 01–03 `open`; 04 `resolved`
(`resolvedAt` + `resolvedBy`); 05 `archived` (`archivedAt` + `archivedBy`).
`submittedAt` derived from as-of. Text passes `validateChallengeText` and is
encrypted; no submitter identity exists in the model and none is added
(anonymity unchanged).

### SkillTree / SkillProgress fixtures
Four **demo-owned org-wide** trees with deterministic ids `demo-skill-*`
(dedicated trees are the only way to guarantee the seed never mutates a
legitimate tree; the ids cannot collide with auto-generated ids of non-demo
trees). Names carry the prefix **"Demo – "** (approved), `createdBy:
"demo-seed"`, nodes `node-0…` with Norwegian labels:
- `demo-skill-testing` "Demo – Testautomatisering" (5 stages); tracked,
  current `node-2`.
- `demo-skill-delivery` "Demo – Leveranse" (6 stages); tracked, current
  `node-4`.
- `demo-skill-observability` "Demo – Observerbarhet" (4 stages); tracked,
  `currentNodeId: null`.
- `demo-skill-secure-dev` "Demo – Sikker utvikling" (4 stages); **not
  tracked**, so the admin "start tracking" picker has something to show.

Progress docs: `{teamId: "demo-team", treeId, currentNodeId, updatedAt,
updatedBy: "demo-seed"}`. Team-level only: no individual progress, history,
XP, achievements, branching or prerequisites.

## Audit actor — field-by-field (BR-21)
Constant `demo-seed` is used **only** where the existing validator/persisted
semantics accept an arbitrary non-empty accountability string (finding 12).
Inspection result of every actor field the fixture persists:

| Field (collection) | Validator / semantics | Value written |
|---|---|---|
| `createdBy` (`teams`) | none beyond persisted string; returned in admin team list, never resolved | `demo-seed` |
| `grantedBy` (`teamMemberships`) | `isValidMembershipFor` checks only `uid`/`teamId`; never resolved | `demo-seed` |
| `createdBy` (`surveys`) | `isNonEmptyString`; listed for admin accountability | `demo-seed` |
| `resolvedBy` (`challenges`, #04) | paired with `resolvedAt`; non-empty string; never returned | `demo-seed` |
| `archivedBy` (`challenges`, #05) | paired with `archivedAt`; non-empty string; never returned | `demo-seed` |
| `createdBy` (`skillTrees`) | `isNonEmptyString`; never returned | `demo-seed` |
| `updatedBy` (`skillProgress`) | `isNonEmptyString`; never returned | `demo-seed` |
| `skillTrees.updatedBy` | paired-optional; **not written** (fresh trees have no update pair) | — |
| `uid` (`teamMemberships`) | identity key of the real member | **presenter uid** |

No field in the current dataset requires a real authenticated admin uid, so
the presenter uid appears only as the membership `uid`/doc-id key. No
validator, schema or domain semantics are changed. If TASK-001 finds any
field for which this table is wrong, it must stop and report rather than
weaken a validator. **Actor values are supporting ownership evidence only**
(see "Ownership model") — never a sufficient ownership mechanism, and, because
product operations legitimately overwrite mutable actor fields with a real
admin uid (`updatedBy`, `resolvedBy`, `archivedBy`), those are *not*
compatibility criteria; only creation-time actors that no product operation
rewrites (`createdBy`, `grantedBy`) are.

## Ownership model (BR-20)
Ownership is the **explicit deterministic manifest of exact document paths**
in the dataset table (ids are hyphenated; none starts and ends with `__`).
`demo-seed` values are supporting evidence only. No `seedOwner`, `isDemo` or
similar field is added; no collection query is used to find or clean up demo
data; there is no broad ownership inference; no deletes in v1. Nothing
changes production id semantics (random ids in production are a `.add()`
convenience, not a validator requirement).

## Manifest classification and conflict handling (BR-23)
**Every** manifest path is read by exact id (online) and classified **before
any write**:
1. `ABSENT`;
2. `COMPATIBLE` — an existing demo-owned record;
3. `CONFLICT`.

Any `CONFLICT` **aborts the whole run with zero writes**. An existing record
is never adopted merely because its doc id matches the manifest.

Behavior by class: **`C` (create-only)** — ABSENT ⇒ planned create;
COMPATIBLE ⇒ no write; CONFLICT ⇒ abort. **`U` (upsert)** — ABSENT ⇒ planned
create/set; COMPATIBLE ⇒ planned deterministic `set`; CONFLICT ⇒ abort.

Compatibility criteria (shape via the real validators):
- `teams/demo-team`: valid shape; `status: "active"`; `createdBy: "demo-seed"`
  (name may have been edited). Disabled/malformed/foreign ⇒ CONFLICT (never
  silently re-enabled).
- Presenter membership: `uid`/`teamId` match, `grantedBy: "demo-seed"`.
  A different/malformed membership at that path ⇒ CONFLICT.
- Closed surveys / `demo-survey-next`: `isValidSurvey`; `teamId:
  "demo-team"`; `createdBy: "demo-seed"`; `accessMode: "authenticated"`;
  `minimumResponses: 5` (immutable at creation). Lifecycle timestamps are
  free (the presenter may have opened/closed `demo-survey-next`). An
  incompatible occupant of the scheduled id ⇒ CONFLICT.
- Responses: exactly the seven fields; `surveyId`/`teamId` match the fixture;
  `keyVersion: "v1"`; **decryptable with the active key** and the decrypted
  value a valid answer tuple (never printed).
- Challenges: `isValidChallenge`; `teamId: "demo-team"`; **decryptable with the
  active key** (never printed). Status/lifecycle is free (an admin may have
  resolved/archived it).
- Skill trees: `isValidSkillTree`; `createdBy: "demo-seed"`; same node count
  and `node-i` ids as the fixture (node structure is immutable in the
  product; other teams may track it). Name/label edits and an `updatedBy`
  pair are tolerated (a `U` set restores the fixture).
- Skill progress: `isValidSkillProgress`; `teamId: "demo-team"`, `treeId`
  matches the path; any `updatedBy` (a presenter edit sets a real uid).

Conflict examples: malformed persisted shape; incompatible teamId/scope;
foreign creation actor; disabled demo-team; incompatible SkillTree
structure; different/malformed presenter membership; scheduled-survey id
occupied by incompatible data; encrypted demo-owned record that cannot be
decrypted with the active key.

## Explicit Forum exclusion (BR-16)
No `forum*` collection is read, written or listed. The writer enforces a
**structural allow-list** of exactly seven collections — `teams`,
`teamMemberships`, `surveys`, `surveyResponses`, `challenges`, `skillTrees`,
`skillProgress` — and additionally a manifest-path check; any attempted
collection outside the allow-list (notably `forumThreads`, `forumReplies`)
fails **before any write**. Tests assert this and that `teamSurveyState`,
`surveyParticipations`, `teamInvitations`, `teamAccessRequests` are never
written.

## Encryption
The seed imports the repository's own `encrypt`/`decrypt` (never a second
implementation); no key in source/fixtures/logs/docs; key only from
`ENCRYPTION_KEY`. Fresh IV per encryption remains normal.

1. **Local crypto preflight (BR-26), mandatory before any online write, and
   also in offline mode:** load the configured key via the existing
   implementation; encrypt a harmless in-memory synthetic probe; decrypt it
   immediately; verify round-trip equality; discard the probe; **no Firebase
   write** (and no network). This detects a missing/malformed/inoperable local
   crypto configuration. **It does not prove the key matches ciphertext
   already stored in Firestore.**
2. **Existing demo-owned encrypted records (BR-27, online dry-run and write
   preflight):** for each manifest path of a demo-owned survey response or
   challenge that already exists, validate its persisted shape and attempt
   decryption with the configured key. Failure ⇒ classify as an
   **encryption-key/data conflict** ⇒ abort before any write; such records are
   never overwritten. Scope is strictly the deterministic manifest paths —
   arbitrary non-demo encrypted records are never inspected. Decrypted
   plaintext is never printed.
3. **Residual limitation:** on a first run (no demo ciphertext exists) the key
   still cannot be checked against Firestore; the coordinator confirms
   `ENCRYPTION_KEY` matches the target app's key at the execution gate.
4. Payloads are encrypted in memory before the write phase; any failure ⇒ zero
   writes. **Idempotence is defined over ids and the final logical dataset,
   not ciphertext bytes** (fresh IV per run).

## Idempotence and re-run behavior
Ids are deterministic and date-free. A `U` rerun `set()`s the same paths to
the same logical fixture (no duplicates), reverting UI edits to owned `U`
records (intentional "reset within owned ids": a presenter-moved skill stage,
a resolved demo challenge). `C` records are never overwritten. A same-`--as-of`
rerun differs only in ciphertext bytes; a later-day rerun also refreshes
`U` dates. Responses a presenter submits to `demo-survey-next` are not owned,
never touched, never deleted.

## Cleanup / deletion policy (BR-25)
v1 has **no deletion path**: no `delete()`, no collection query, no wildcard;
the reader/writer seams expose no delete or query method. Removing demo data
is a manual act outside this feature; retiring an id needs a new spec.

## Execution interface (proposed — not yet implemented)
```
pnpm seed:demo-team -- --project <id> --presenter-uid <uid> [--as-of YYYY-MM-DD] [--offline]
pnpm seed:demo-team -- --project <id> --presenter-uid <uid> --write --confirm <id>
```
Unknown/missing/duplicate flags, or `--write` combined with `--offline`,
abort before any network.

### Runtime rule (BR-32)
Preferred direction: **native Node ≥ 24** (type stripping, `--env-file`, the
`react-server` condition for `server-only`), no new dependency. TASK-005 must
**first attempt the narrowest runtime structure compatible with existing
dependencies and Node 24** — minimizing the set of modules executed by native
Node, importing only `encryption.ts` and pure domain validators from the app,
and avoiding any change to global TypeScript compiler behavior merely for the
seed. Rules: no new dependency by default; no `tsx` by default; no package
addition without coordinator approval. **STOP and report before making the
change** if implementation proves that either (a) `allowImportingTsExtensions`
(or another compiler-behavior/`include`/`exclude` change to `tsconfig`) or (b)
a new runtime dependency such as `tsx` is genuinely required. A `package.json`
**script** may be added if safe.

## Dry-run semantics (BR-3, BR-28, BR-29)
**Default = dry-run.**
- `--offline`: zero network calls, zero Firebase reads, zero writes; validates
  arguments, config, project consistency, fixture construction, manifest and
  the local crypto round-trip; prints a safe plan summary.
- **Online dry-run**: verifies the exact project (credentials ↔ `--project`),
  presenter Auth lookup (`getUser`, existence only), reads only deterministic
  manifest ids, classifies (validates/decrypts existing demo-owned encrypted
  records), zero writes. Reports the **exact resolved project id**, mode,
  team id, presenter uid (never email), as-of date, counts by collection,
  per-path action (`create`, `set`, `skip (exists)`, `blocked (category)`),
  deletes (always 0), the visibility warning, the app-admin prerequisite
  reminder, and the crypto/key result.
- **`--write`**: requires a successful equivalent preflight; requires
  `--confirm` exactly equal to `--project`; **is not coordinator approval** —
  the first real execution requires the coordinator's explicit approval of the
  exact project id, outside the script.
- **Never printed**: encryption key, bearer token, service-account private
  key, ciphertext/iv/authTag, decrypted challenge text, decrypted survey
  payload, presenter email. Failures print a classified category only, never
  raw exception text.

## Atomicity (BR-30)
Within the write phase: all required online reads/preflight happen **before**
the batch; all encryption happens **before** the batch; the write phase is
**one Firestore `WriteBatch`** (82 operations, asserted ≤ 400; limit 500).
Preflight/encryption failure ⇒ zero writes. If the commit fails, Firestore
batch atomicity means **no partial batch is committed**. `C` records use
`batch.create()`, so a concurrent creation between preflight and commit makes
the whole batch fail atomically. **The operation as a whole is not isolated
from concurrent external modifications between preflight reads and commit**
(e.g. a `U` record edited in that window is overwritten; a conflicting record
appearing in that window is not re-classified): this is a documented residual
operational risk (Residual risk 5). No transaction is introduced unless
repository/API constraints prove it necessary. If a commit's outcome is
unknown (network loss), rerunning is safe: it converges. No atomicity across
separate runs.

## Security and privacy
- The tool **bypasses app-level authorization by design** (Admin SDK under
  service-account credentials, unlike `seedLegacyTeams`). Its authorization
  boundary is credential possession + explicit project proof + the
  coordinator execution gate. It adds no endpoint.
- No secrets in source/docs/Firestore/git; no plaintext sensitive content in
  Firestore (invariants 1–5); anonymous records carry no identity (6) and no
  participation records are written (7); thresholds honored (11–12); Forum
  untouched; deny-all client rules untouched; no individual skill/performance
  data.
- Presenter uid stored only as the membership key; email never stored,
  printed, logged, or even read into output. Logging: ids, statuses, counts.

## Performance / operational limits
82 writes in one batch, ~1 KB each; encrypting 64 payloads is sub-second.
Reads: ≤ 82 `get`s by known id plus one `getUser`; no queries.

## Testing
Vitest, no live Firebase, no network; writer/reader/Auth are injected fakes
(repo convention: one seam per operation). Tests import the real validators
and real `computeSurveyAggregate` with a throwaway in-memory key via
`vi.stubEnv` — never a real key. See "Test boundaries".

## Documentation
On implementation: `docs/DEVELOPMENT.md` gains a "Demo Team seed" section
(invocation, modes, execution gate, what is written, no deletes, Node ≥ 24 if
kept, `ENCRYPTION_KEY` must match the target app, visibility caveat,
presenter/`APP_ADMIN_EMAILS` prerequisite). Not expected: `DATA-MODEL.md` (no
schema/ownership field), `.env.local.example` (no new variable),
`ROADMAP.md` (tooling). The command is **proposed** until TASK-005 lands;
`DEVELOPMENT.md` must not describe it earlier.

## Behavioral requirements
**Target & execution safety**
- BR-1. `--project <id>` is required in every mode; the tool never uses a
  default project, `.firebaserc`, the Firebase CLI, `gcloud` or
  `applicationDefault()`/ambient credentials, hard-codes no project id or
  allow-list, and no project is pre-approved by any planning document.
- BR-2. Admin credentials come only from the complete `FIREBASE_PROJECT_ID`/
  `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` trio; `--project` must equal
  `FIREBASE_PROJECT_ID`, equal `NEXT_PUBLIC_FIREBASE_PROJECT_ID` when set, and
  match the service-account email domain; any mismatch aborts before network
  (fail closed).
- BR-3. Default mode is dry-run. `--offline` performs zero network calls,
  reads and writes and cannot be combined with `--write`. Writes require
  `--write` **and** `--confirm <id>` exactly equal to `--project`.
  Unknown/missing/duplicate flags abort before any network.
- BR-4. Execution gate: offline dry-run → online dry-run reporting the exact
  resolved project id → explicit coordinator approval of that exact id →
  first `--write`. `--confirm` is not approval; if the target cannot be
  determined, nothing runs.
- BR-5. `--presenter-uid` is required; online, `getUser(uid)` is an
  existence-only check (failure/not-found aborts); no Auth user, password,
  token or credential is created/updated; the email is never read into
  output, stored, printed or logged; app-admin membership is never inferred
  from the uid; `APP_ADMIN_EMAILS`/app env is never edited — it is documented
  as an external demo prerequisite.
- BR-6. Preflight failures exit non-zero with category-only messages and zero
  writes.

**Dataset**
- BR-7. `teams/demo-team` per the fixture (`Demoteam`, `active`, `demo-seed`).
- BR-8. The presenter's `teamMemberships/{uid}__demo-team` per the fixture
  (`createdVia: "admin_direct"`, `grantedBy: "demo-seed"`); no other
  membership, invitation or access request.
- BR-9. Eight closed surveys and one scheduled survey (`demo-survey-next`)
  exist as specified, all valid `Survey` shape; the eight closed ones fall in
  the 12-survey trend window.
- BR-10. Exactly 59 responses: 8 in each of periods 1, 2, 4–8 (7 × 8 = 56) and
  3 in period 3; every answer tuple is three integers 1–5; the seven full
  periods publish, period 3 is `insufficient` under the **real** aggregation
  rule (3 < `minimumResponses` 5), the latest period publishes; per-dimension
  means match the table within ±0.13; **the scheduled survey has zero
  responses**; aggregation logic is unmodified.
- BR-11. Response documents contain exactly the seven `SurveyResponseRecord`
  fields — no identity field, no `surveyParticipations`/`teamSurveyState`
  write.
- BR-12. All response answers and challenge text are encrypted with the
  repository's `encrypt` (fresh IV per call); no plaintext sensitive content
  reaches Firestore or any output.
- BR-13. Five challenges: open ×3, resolved ×1, archived ×1, valid per
  `isValidChallenge`.
- BR-14. Challenge documents contain no submitter identity (anonymity
  unchanged); acting-admin fields follow BR-21.
- BR-15. Four demo-owned org-wide skill trees (ids `demo-skill-*`, names
  prefixed "Demo – ", 2–20 valid nodes) and three progress documents: one
  tracked at a middle node, one at another valid node, one with `null`, one
  tree untracked; every `currentNodeId` is a valid node; no individual/
  history/gamification data.
- BR-16. Only the seven allow-listed collections may be written; any other
  collection (notably `forumThreads`, `forumReplies`) is rejected before any
  write; tested.
- BR-17. All content is synthetic, fictional, non-identifying, held in
  structured fixtures.
- BR-18. The dataset is exactly 82 documents with the id sets in this SPEC
  (1/1/9/59/5/4/3), no duplicate paths, ≤ 400 (batch limit 500).
- BR-19. All timestamps derive solely from `--as-of` (default: today UTC)
  by the algorithm in "Survey fixtures and timing"; ids contain no date; a
  later-day rerun yields the same ids, no duplicate periods, refreshed `U`
  dates; `C` dates are never rewritten.

**Ownership, idempotence, conflicts**
- BR-20. Ownership is the explicit deterministic manifest of exact document
  paths; a write outside the manifest is rejected; no `seedOwner`/`isDemo`
  field is added to any schema; no collection query is used for ownership.
- BR-21. `demo-seed` is written only in the fields listed in "Audit actor —
  field-by-field"; the presenter uid is used only as the membership `uid`;
  no validator/schema/domain semantics are changed; actor values are
  supporting evidence only, and mutable-by-product actor fields
  (`updatedBy`/`resolvedBy`/`archivedBy`) are not compatibility criteria.
- BR-22. `U` records are `set()` to the fixture; `C` records are written only
  if absent (`create()` in the batch); a same-`--as-of` rerun converges to the
  same logical dataset with no duplicates; only ciphertext bytes differ.
- BR-23. Every manifest path is classified ABSENT / COMPATIBLE / CONFLICT
  before any write; any CONFLICT aborts the entire run with zero writes;
  COMPATIBLE `C` ⇒ no write, COMPATIBLE `U` ⇒ deterministic `set`; existing
  records are never adopted by id match alone.
- BR-24. An existing demo tree whose node count/ids differ from the fixture is
  a CONFLICT (subsumed under BR-23 criteria; separately tested).
- BR-25. The tool has no delete operation, no wildcard/collection-wide
  operation and no query; the dry-run reports 0 deletes.

**Encryption preflight**
- BR-26. Before any write (and in offline mode) a local crypto round-trip
  (encrypt probe → decrypt → equality → discard) runs with the configured key
  using the existing implementation; failure aborts; the limitation (no proof
  against stored ciphertext) is documented and reported accurately.
- BR-27. In online preflight, an existing demo-owned encrypted response or
  challenge at a manifest path is shape-validated and decrypted; a failure is
  an encryption-key/data CONFLICT that aborts before any write and is never
  overwritten; only manifest paths are inspected; no plaintext is printed.

**Dry-run, output & atomicity**
- BR-28. Dry-run (offline and online) performs zero writes and prints the
  content listed in "Dry-run semantics", including the exact resolved project
  id, the visibility warning and the app-admin reminder.
- BR-29. Online dry-run and write use reads by known id (+ one `getUser`)
  only; offline uses no network and no reads.
- BR-30. All required reads and all encryption complete before the write
  phase; the write phase is a single Firestore batch (≤ 400 asserted);
  pre-commit failure ⇒ zero writes; a failed commit commits nothing; the
  preflight-to-commit race is documented as residual (not claimed isolated).
- BR-31. No key, token, service-account material, ciphertext/iv/authTag,
  decrypted plaintext, or presenter email is printed, logged or written to any
  file; failures print a classified category only.

**Invariants & docs**
- BR-32. No change to product behavior (no API route, UI, schema, rule, index,
  domain type, aggregation logic or existing server operation) and no
  dependency change; a `package.json` script is the only permitted config
  change; any `tsconfig` compiler-behavior change or new dependency
  (`tsx` etc.) requires a STOP-and-report before making it.
- BR-33. Ordinary tests run entirely without Firebase, network or a real key.
- BR-34. `docs/DEVELOPMENT.md` documents the tool only once it exists
  (command marked proposed until then), including the execution gate and the
  presenter/`APP_ADMIN_EMAILS` prerequisite.

## Edge cases and failure behavior
- `demo-team` exists disabled ⇒ CONFLICT, abort (no re-enable).
- Presenter membership exists with `grantedBy: "demo-seed"` ⇒ compatible,
  skipped; any other occupant ⇒ CONFLICT.
- Presenter opened `demo-survey-next` ⇒ compatible C, untouched.
- Presenter moved a demo skill stage / resolved a demo challenge ⇒ compatible;
  `U` rerun resets it.
- Another team tracks a `demo-skill-*` tree: cosmetic label overwrite allowed;
  structure mismatch ⇒ CONFLICT.
- Existing demo response/challenge undecryptable with the active key ⇒ CONFLICT.
- `--as-of` future: allowed; invalid format aborts.
- Service account lacks Firestore permission: preflight/commit fails, exit
  non-zero, nothing partially committed.

## Architecture decisions
- Feature-owned slice `src/features/demo-team/`; no global `scripts/` folder
  (`.claude/rules/architecture.md`).
- Pure plan builder + injected `encrypt`/`decrypt` and `Reader`/`Writer`
  seams; real Admin SDK adapters are thin and live only in the CLI wiring.
- Direct Admin SDK writes replicating `server/` record shapes, validated in
  tests against the real domain validators (shape-drift guard), rather than
  calling `server/` operations (app-admin token, random ids) or modifying
  them.
- The Reader seam exposes only `get(path)`; the Writer seam exposes only
  guarded `create`/`set` inside one batch — no delete, no query.

## Test boundaries
| Boundary | Covers |
|---|---|
| Fixtures/manifest/plan (pure; real validators + real `computeSurveyAggregate`) | BR-7–BR-15, BR-17–BR-21 |
| Arg/env/project parsing (pure) | BR-1–BR-3, BR-5 (input), BR-6 |
| Guarded writer with fake batch | BR-16, BR-22, BR-25, BR-30 |
| Preflight/classification/dry-run with fake reader/Auth/crypto | BR-4 (gate text), BR-5, BR-6, BR-23, BR-24, BR-26–BR-29, BR-31 |
| Runner with fakes (dry-run zero writes, write = one batch, rerun convergence, failure injection) | BR-3, BR-22, BR-28–BR-31 |
| Config/static checks (`package.json`/`tsconfig`/deps; no forum path; no `delete` symbol) | BR-16, BR-25, BR-32, BR-33 |
| CLI smoke: offline dry-run under real Node, no Firebase | BR-3, BR-26, BR-28, BR-29 |
| Review / docs check | BR-4, BR-34 |

## Acceptance criteria
- [ ] Missing/mismatched project, credentials, presenter, key, or unknown flag
      aborts before any network/write.
- [ ] Dry-run default; offline mode uses no network/reads; both perform zero
      writes.
- [ ] Plan is 82 documents (1/1/9/59/5/4/3) and validates against the real
      domain validators and real aggregation (7 published periods, 1
      insufficient, latest published, scheduled survey with 0 responses).
- [ ] Every path is manifest-enumerated; nothing outside the seven collections
      is written; no delete/query exists.
- [ ] Any CONFLICT (incl. undecryptable existing demo ciphertext) aborts with
      zero writes; second run (fake store) yields the same logical documents
      with no duplicates; `C` records are not overwritten.
- [ ] Local crypto round-trip precedes any write.
- [ ] No plaintext sensitive content or forbidden output anywhere.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass; no new
      dependency; no schema/API/UI/rules/index diff.
- [ ] `DEVELOPMENT.md` documents the tool, execution gate and admin
      prerequisite.
- [ ] No live Firebase write occurred during implementation, and no `--write`
      ran without explicit coordinator approval of the exact project id.

## Residual risks
1. **Visibility**: on any target project, "Demoteam" appears in every
   signed-in user's `/teams` and demo skill trees in every admin's catalog and
   cross-team overview; no hiding mechanism without product change.
2. **Target project is an execution decision**: no staging/production
   distinction is defined in the repo; the coordinator decides at the gate
   whether the exact resolved project may receive demo data.
3. **Key match on first run** cannot be verified from Firestore; a wrong key
   yields undecryptable responses and blank/insufficient results. Local
   round-trip only proves the local key works.
4. `U` reruns discard presenter edits to owned records; no undo.
5. **Preflight-to-commit race**: concurrent external modification between
   preflight reads and batch commit is not detected (except `C` creation
   collisions, which fail the batch).
6. The seed replicates record shapes; a future schema change could make it
   stale (mitigated by validator-based tests).
7. Bypasses app authorization by design; safety rests on credentials and the
   execution gate.
8. Node ≥ 24 requirement if the native-runtime option is kept.

## Open questions
None. (Resolved: tree naming "Demo – "; scheduled survey + one insufficient
period included; native-Node-preferred runtime with stop gate; audit actor
rule; target project modeled as an execution gate.)
