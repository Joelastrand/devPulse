# DevPulse — Development Workflow

## Feature workflow

```
Feature idea
    ↓
plan-feature        →  docs/features/<feature-id>/SPEC.md
    ↓
split-tasks         →  docs/features/<feature-id>/TASKS.md
    ↓
implement-task       (one task at a time)
    ↓
review-change
    ↓
Done
```

## Bug workflow

```
Bug
    ↓
debug
    ↓
reproduction
    ↓
fix
    ↓
regression test
```

## Persistent feature files

```
docs/features/<feature-id>/
├── SPEC.md    — requirements for the feature
└── TASKS.md   — task status for the feature
```

`TASKS.md` is the single owner of task status: **Ready**, **In Progress**,
**Done**. Status is not duplicated in `CLAUDE.md` or other docs. Normally
only one task per feature should be **In Progress** at a time.

## Local Firebase setup

One-time steps in the [Firebase Console](https://console.firebase.google.com/)
to get a local environment working, before filling in `.env.local` (copy it
from `.env.local.example`, which documents each variable):

1. Create or open the Firebase project for this environment.
2. Register a **Web app** (Project settings → General → Your apps) and copy
   its config values into the `NEXT_PUBLIC_FIREBASE_*` variables.
3. **Authentication** → Sign-in method → enable **Email/Password**.
4. **Firestore Database** → create the database (production mode).
5. Project settings → **Service accounts** → Generate new private key. From
   the downloaded JSON, map:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (keep the literal `\n` sequences)
6. Generate a separate `ENCRYPTION_KEY` for this environment (see the table
   below) — never reuse another project's or environment's key.
7. Never commit `.env.local`; it is git-ignored (`.env.local.example` is the
   committed template).
8. Deploy Firestore rules and indexes — having the files locally does **not**
   configure a real Firestore project by itself:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

9. Seed the legacy team IDs into Firestore before exercising `/teams` or
    `/teams/[teamId]` end-to-end against a real project — `/teams`'s
    overview reads the Firestore `teams` collection's `active` set
    (`docs/features/team-management/SPEC.md` TASK-006), so a fresh
    Firestore project has no teams until this step runs. As an app admin
    (see `APP_ADMIN_EMAILS` below), call the seed endpoint once:

    ```bash
    curl -X POST https://<your-app-host>/api/admin/teams/seed-legacy \
      -H "Authorization: Bearer <your Firebase ID token>"
    ```

    It creates the four legacy `teams` documents (`platform`, `web-app`,
    `mobile`, `data-platform`) with those exact IDs if they don't already
    exist. It is idempotent and safe to re-run — an existing team document
    (including a disabled one) is never overwritten or silently
    re-enabled. It never runs automatically; nothing in the application
    calls it on startup or on any other request path.

`.firebaserc` (created by `firebase use --add` and read by the `firebase`
CLI to pick a default project) is intentionally **git-ignored**, not
committed. The project id itself isn't a secret, but committing it would
make it the default `firebase deploy` target for every clone of this repo
— a low-value convenience next to the risk of an accidental deploy to the
wrong (or a shared) project. Run `firebase use --add` locally per
environment instead; it's a one-time step and does not affect Firestore
rules, indexes, auth, or application behavior.

## Environment variables

| Variable | Required for | Notes |
| --- | --- | --- |
| `ENCRYPTION_KEY` | `src/lib/encryption/` (server-only) | Base64-encoded 256-bit (32-byte) AES-256-GCM key, e.g. generated with `openssl rand -base64 32`. Server-only; never expose via `NEXT_PUBLIC_*`. Missing, empty, or malformed values cause encryption to fail closed (no plaintext fallback). Real key management (rotation, KMS) is deferred — see `docs/ARCHITECTURE.md`. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `src/lib/firebase/` (server-only, Firebase Admin SDK) | Service-account credentials for Firestore access from server code only. If unset, initialization falls back to the platform's default application credentials (e.g. `GOOGLE_APPLICATION_CREDENTIALS`, useful for local `gcloud` auth or a deployment platform's built-in service account). The Demo Team seed (see "Demo Team seed") does **not** fall back: it requires all three. Server-only; never expose via `NEXT_PUBLIC_*`. Not required to run `pnpm test` (Firestore access is mocked/injected in tests). |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | `src/lib/firebase/client.ts` (browser-safe, Firebase client SDK) | Firebase web app config for browser-side sign-up/sign-in (`src/features/auth/`). These identify the Firebase project but are not secrets, unlike the Admin SDK credentials above — do not add real service-account material here. Not required to run `pnpm test` (the Firebase client SDK call boundary is mocked/injected in tests). |
| `APP_ADMIN_EMAILS` | `src/features/teams/domain/app-admin.ts` (server-only) | Comma-separated allow-list of app-admin email addresses, normalized (trimmed, lowercased) at read time. An account is treated as an app admin only if its email is also Firebase-verified (`docs/features/team-management/SPEC.md` — BR-5, BR-6). Server-only; never exposed via `NEXT_PUBLIC_*` or returned to a client. Missing/empty means no app admins. Not required to run `pnpm test` (injected via an explicit allow-list in tests). |
| `FEATURE_FORUM_ENABLED` | `src/features/forum/server/is-forum-enabled.ts` (server-only) | UI/product-availability flag for the Forum feature — set to exactly `"true"` to show the Forum UI on `/teams/[teamId]` and its standalone thread-detail page; missing, `"false"`, or any other value hides it (fails closed). Not a security control: Forum's server-side authorization, encryption, and API routes are unaffected and remain active regardless of this value (`docs/features/team-forum/SPEC.md` — "Feature flag"). Server-only; never exposed via `NEXT_PUBLIC_*`. Not required to run `pnpm test` (injected via an explicit value in tests). |

## Firestore rules and indexes

`firestore.rules` and `firestore.indexes.json` (both referenced from
`firebase.json`) are the source of truth for Firestore access control and
required composite indexes — both must be deployed together:

```
firebase deploy --only firestore:rules,firestore:indexes
```

- **`firestore.rules`** denies all Firestore client-SDK reads and writes
  unconditionally, on every collection. This app's own code never needs
  client-SDK Firestore access to be allowed: all server code
  (`src/lib/firebase/admin.ts`, used by `src/features/surveys/server/` and
  `src/features/results/server/get-team-survey-results.ts`) reads/writes
  Firestore through the Firebase **Admin** SDK, which always bypasses
  Security Rules — the client SDK (`src/lib/firebase/client.ts`) is
  Auth-only in this codebase and never calls Firestore. Without this file
  deployed, the browser's public `NEXT_PUBLIC_FIREBASE_*` web config would
  be enough for any client to query `surveyResponses` (or any other
  collection) directly, bypassing this feature's server-side team scoping,
  survey-lifecycle exclusion, and minimum-response threshold entirely
  (`docs/SECURITY.md` invariants 8–11). Do not loosen this file to permit
  client reads/writes without an explicit, reviewed decision to introduce
  direct client Firestore access.
- The `teams`, `teamMemberships`, `teamInvitations`, `teamAccessRequests`
  (`docs/features/team-management/SPEC.md`), `surveys`, `teamSurveyState`,
  `surveyResponses`, and `surveyParticipations`
  (`docs/features/managed-surveys/SPEC.md`), `challenges`
  (`docs/features/anonymous-challenges/SPEC.md`), `forumThreads`/
  `forumReplies` (`docs/features/team-forum/SPEC.md`), and `skillTrees`/
  `skillProgress` (`docs/features/team-skill-tree/SPEC.md`) collections each
  have the same explicit deny block, for the same defense-in-depth/
  documentation reason — all access happens server-side via
  `src/features/teams/server/`, `src/features/surveys/server/`,
  `src/features/challenges/server/`, `src/features/forum/server/`, or
  `src/features/skill-trees/server/`, which use the Admin SDK and bypass
  these rules entirely.
- **`firestore.indexes.json`** declares:
  - The composite index on `teamInvitations` (`email` ascending, `status`
    ascending) `resolveInvitations` (`src/features/teams/server/
    resolve-invitations.ts`) depends on to look up a caller's own pending
    invitations (docs/features/team-management/SPEC.md — BR-20). Without
    this index deployed, invitation resolution fails closed with a
    read-failure response against a real Firestore project.
  - The composite index on `teamAccessRequests` (`teamId` ascending,
    `status` ascending) `listTeamAccessRequests` (`src/features/teams/
    server/list-team-access-requests.ts`) depends on for an admin's
    pending-request view (docs/features/team-management/SPEC.md — BR-30).
    Without this index deployed, that listing fails closed with a
    read-failure response against a real Firestore project.
  - `listActiveTeams` (`src/features/teams/server/list-active-teams.ts`,
    backing the `/teams` overview) filters `teams` by `status == "active"`
    alone — a single-field equality filter, which Firestore indexes
    automatically. No composite index entry is needed or declared for it.
  - Querying `surveys` by `teamId` (the admin team page and team-page
    survey discovery) and `surveyResponses` by `surveyId` (results/history)
    are likewise single-field, auto-indexed queries — no composite index
    entry is needed or declared for either
    (`docs/features/managed-surveys/SPEC.md` → "Firestore/index
    implications"). The one-open-survey-per-team check needs no index at
    all: it's a direct document `get` on `teamSurveyState/{teamId}`, never
    a query.
  - The composite index on `forumThreads` (`teamId` ascending, `createdAt`
    **descending**) `listTeamThreads` depends on for a team's newest-first
    thread list (`docs/features/team-forum/SPEC.md` — BR-34). Without this
    index deployed, that listing fails closed with a read-failure response
    against a real Firestore project.
  - The composite index on `forumReplies` (`threadId` ascending, `createdAt`
    **ascending**) `getThreadWithReplies` depends on for a thread's
    oldest-first reply list (`docs/features/team-forum/SPEC.md` — BR-34) —
    ascending, unlike `forumThreads`' descending order, since every reply of
    a thread is always returned in full rather than a "most-recent-N,
    reversed" window. Without this index deployed, thread-detail reads fail
    closed with a read-failure response against a real Firestore project.
  - `createReply`'s 500-reply-capacity check (`forumReplies.where("threadId",
    "==", threadId).count()`) and `deleteThread`'s reply-cascade query
    (`forumReplies.where("threadId", "==", threadId).limit(500)`) are each a
    single-field equality filter with no `orderBy` — Firestore indexes these
    automatically, so no composite index entry is needed or declared for
    either.
  - `listSkillTrees` (`src/features/skill-trees/server/list-skill-trees.ts`)
    queries `skillTrees` with `.orderBy("createdAt", "asc").limit(500)` and
    no `.where()` — a single-field `orderBy` with no additional filter,
    auto-indexed; `.limit()` never triggers an index requirement either
    (`docs/features/team-skill-tree/SPEC.md` — BR-25). `getTeamSkillProgress`
    queries `skillProgress` with a single-field equality filter
    (`where("teamId", "==", teamId)`), likewise auto-indexed. Every other
    Skill Tree operation (create/correct a tree; start/update/stop tracking)
    is a direct document `get`/`add`/`set`/`update`/`delete` by a
    deterministic or already-known id, not a query. No composite index is
    declared for this feature.

Add new composite indexes or rule changes here whenever a new Firestore
query or access path is introduced, rather than relying on manually
console-created configuration.

## Demo Team seed

Spec: `docs/features/demo-team/SPEC.md`. Code: `src/features/demo-team/`.

`pnpm seed:demo-team` writes one small, fictional, deterministic dataset — the
"Demoteam" (`teams/demo-team`) — into an **explicitly named** Firebase project
so results/trend, surveys, challenges and skill paths look alive. It is
**not a normal development command**: with `--write` it modifies a real
Firestore project using service-account credentials that bypass all
application authorization. Nothing in the repo approves any project; no real
seeding is part of the feature's implementation.

### What it writes (82 documents, one batch)

`teams` 1 · `teamMemberships` 1 (the presenter) · `surveys` 9 (8 closed + the
scheduled `demo-survey-next`) · `surveyResponses` 59 (encrypted; none for the
scheduled survey) · `challenges` 5 (encrypted) · `skillTrees` 4 (org-wide,
names prefixed "Demo – ") · `skillProgress` 3. Ids are fixed and date-free; all
timestamps derive from `--as-of`. It never writes Forum data,
`teamSurveyState`, `surveyParticipations`, invitations, access requests or Auth
users, never deletes or queries, and adds no schema field. Ownership is the
explicit list of exact paths (the manifest), not a marker field.

### Invocation (verified syntax)

```bash
# 1. Offline: no network, no Firebase reads
pnpm seed:demo-team -- --project <project-id> --presenter-uid <uid> --offline [--as-of YYYY-MM-DD]

# 2. Online dry-run (the default): read-only against the target project
pnpm seed:demo-team -- --project <project-id> --presenter-uid <uid> [--as-of YYYY-MM-DD]

# 3. Write — only after coordinator approval, see "Execution gate"
pnpm seed:demo-team -- --project <project-id> --presenter-uid <uid> --write --confirm <project-id>
```

pnpm 10 forwards a leading `--` to the script; the tool strips exactly one
leading `--`. Omitting it also works. Any other positional argument, unknown,
duplicate or value-less flag aborts before any network. `--offline` cannot be
combined with `--write`; `--confirm` is only valid with `--write` and must
equal `--project`. `--as-of` is a strict real `YYYY-MM-DD` date (default: today
UTC). Exit code: `0` ok, `1` preflight/adapter/write failure, `2` usage or
configuration error. Output is limited to fixed categories, ids and counts.

The script is `node --conditions=react-server --import
./src/features/demo-team/register-ts-resolver.mjs
--env-file-if-exists=.env.local src/features/demo-team/cli.ts`. It needs
**Node ≥ 24** (native type stripping; the repo does not pin a Node version) and
no extra dependency. The `.mjs` hook only resolves extensionless imports to
`.ts`; `--conditions=react-server` lets `server-only` load. `.env.local` is
read if present, but variables already set in the shell take precedence.

### Environment and credentials

All of these are required in every mode, including `--offline`; nothing is
inferred or defaulted. Blank values count as unset.

| Variable | Placeholder | Rule |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `<project-id>` | Must equal `--project`. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `<project-id>` | Optional, but if set (e.g. in `.env.local`) it must equal `--project`; a leftover value for another project aborts the run. |
| `FIREBASE_CLIENT_EMAIL` | `<name>@<project-id>.iam.gserviceaccount.com` | Service-account email; its domain must match `--project`. |
| `FIREBASE_PRIVATE_KEY` | `"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"` | Literal `\n` sequences are replaced with real newlines only when the credential is built (as in `src/lib/firebase/admin.ts`). |
| `ENCRYPTION_KEY` | base64 32-byte key | Must be the **same key the target app uses**; see below. |
| `--presenter-uid` (argument, not env) | `<uid>` | An existing Firebase Auth uid; used only as the membership key. Email is never an input. |

Unlike the app, the seed **never** falls back to `applicationDefault()`,
`GOOGLE_APPLICATION_CREDENTIALS`, `.firebaserc`, the Firebase CLI or `gcloud`.
It adds no new environment variable.

### Modes

| | Offline | Online dry-run | Write |
| --- | --- | --- | --- |
| Network / Firebase | none; `firebase-admin` is not even loaded | Auth `getUser` + Firestore `get` by exact id | same as dry-run, then one batch commit |
| Writes | 0 | 0 | 82 at most (fewer if compatible create-only records exist) |
| Verifies | argument/env/target consistency, plan construction (82 docs, manifest), local crypto round-trip | all of offline, plus: credentials bound to the project, presenter exists, every manifest path classified, existing encrypted demo records decryptable | all of dry-run, plus the write gates below |
| Does **not** verify | anything about existing Firestore state, presenter existence, or that `ENCRYPTION_KEY` matches the target | that the key matches the target on a first run; app-admin status of the presenter | same; also not isolated from concurrent edits (see residual risks) |

- **Offline** proves only local consistency. It says nothing about what is in
  Firestore, and its "Writes planned: 82" is not a prediction of a real run.
- **Online dry-run** prints the exact resolved project id, mode, presenter uid
  (never email), as-of date, counts per collection, the action per manifest
  path (`create`, `set`, `skip (exists)`, `blocked (<reason>)`), `Deletes: 0`,
  a visibility warning and the admin reminder. It performs no writes.
- **Write** adds the gates below. Treat it as a production-data operation.

### Execution gate (before the first real `--write`)

1. Run offline; check the printed project id.
2. Run the online dry-run against the intended project; read the report.
3. **The coordinator (a human) explicitly approves that exact project id**, and
   confirms `ENCRYPTION_KEY` matches the target app. No document, earlier step
   or observed local `.firebaserc` approves a project; `--confirm` is a typo
   guard, not approval. An agent must never run `--write` on its own.
4. Only then run `--write --confirm <project-id>`.

Write proceeds only if **all** hold: `--write` and `--confirm` equal to
`--project` · not `--offline` · env trio and public project id match `--project`
· local crypto round-trip ok · plan built and all 64 payloads encrypted ·
Admin app bound to the proven project · presenter exists in Auth · every
manifest path read with zero conflicts · at least one operation planned. The
guarded writer then re-checks that every operation is on one of the seven
collections and in the manifest, and commits them in **one** Firestore batch
(`create` for create-only records, `set` without merge for upserts). Reads and
encryption finish before the batch; any earlier failure means zero writes, and
a failed commit commits nothing.

### Conflicts and reruns

Every manifest path is read by exact id and classified before any write:

| Situation | Result |
| --- | --- |
| Target empty | all 82 planned (`create`/`set`) |
| Compatible demo documents already exist | upsert (`U`) records are `set` again to the fixture (presenter edits to them are reverted, e.g. a moved skill stage or a resolved demo challenge); create-only (`C`: team, membership, scheduled survey) records are skipped, so a same-as-of rerun writes 79 |
| Only some documents exist | missing ones created, compatible ones handled as above |
| A document is incompatible or foreign | **abort, zero writes.** Reasons: `malformed-shape`, `scope-mismatch`, `foreign-creator`, `team-disabled`, `membership-mismatch`, `structure-mismatch`, `undecryptable` |
| An existing demo response/challenge cannot be decrypted with the active key | `undecryptable` conflict: abort, zero writes, never overwritten |

A document is never adopted merely because its id matches. Only manifest paths
are ever read; other encrypted records are never touched. Rerunning is
idempotent over ids and logical content (ciphertext bytes differ each run;
later `--as-of` moves `U` dates forward). Responses a presenter submits to
`demo-survey-next` are not owned and are never touched.

### Security guardrails

Explicit target proof in every mode · no ambient credentials or project
discovery · local crypto round-trip and read-only preflight before write ·
structural seven-collection allow-list plus manifest check in the writer · one
batch, ≤ 400 operations · no delete, query or wildcard method exists on the
reader/writer seams · encrypted-only sensitive content, no identity in
anonymous records, no participation records · output and errors contain no
key, credential, ciphertext/iv/authTag, decrypted text, presenter email or raw
exception text. Removing demo data is a manual act outside this tool.

### Residual risks

- **Preflight-to-commit race:** a concurrent external change between the
  preflight reads and the commit is not detected. A `U` record edited in that
  window is overwritten and a newly conflicting record is not re-classified;
  only a concurrent creation of a `C` record fails the (atomic) batch.
- **Key match:** on a first run nothing in Firestore can prove `ENCRYPTION_KEY`
  matches the target app; a wrong key yields undecryptable/blank results.
- **Visibility:** "Demoteam" shows in every signed-in user's `/teams`, and the
  demo skill trees to every app admin, on the chosen project.
- **Presenter admin rights:** presenting admin surfaces needs the presenter's
  verified email in the app's `APP_ADMIN_EMAILS` (not read, checked or changed
  by the seed).
- Reruns discard presenter edits to owned upsert records; there is no undo.
- Record shapes are replicated, so a later schema change may make the seed
  stale (validator-based tests guard this).
- The tool bypasses app authorization by design; safety rests on credentials
  and the execution gate.
- Not exercised by tests: real `firebase-admin` Firestore/Auth behavior (only
  fakes, the real `cert()` and `Timestamp`). The first real dry-run is the
  first contact with the live SDK path.

## Skills

The workflow above is driven by six Claude Code skills under
`.claude/skills/`: `plan-feature`, `split-tasks`, `implement-task`,
`review-change`, `debug`, `security-review`. See each `SKILL.md` for its
exact procedure.
