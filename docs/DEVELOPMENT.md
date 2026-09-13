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
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `src/lib/firebase/` (server-only, Firebase Admin SDK) | Service-account credentials for Firestore access from server code only. If unset, initialization falls back to the platform's default application credentials (e.g. `GOOGLE_APPLICATION_CREDENTIALS`, useful for local `gcloud` auth or a deployment platform's built-in service account). Server-only; never expose via `NEXT_PUBLIC_*`. Not required to run `pnpm test` (Firestore access is mocked/injected in tests). |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | `src/lib/firebase/client.ts` (browser-safe, Firebase client SDK) | Firebase web app config for browser-side sign-up/sign-in (`src/features/auth/`). These identify the Firebase project but are not secrets, unlike the Admin SDK credentials above — do not add real service-account material here. Not required to run `pnpm test` (the Firebase client SDK call boundary is mocked/injected in tests). |
| `APP_ADMIN_EMAILS` | `src/features/teams/domain/app-admin.ts` (server-only) | Comma-separated allow-list of app-admin email addresses, normalized (trimmed, lowercased) at read time. An account is treated as an app admin only if its email is also Firebase-verified (`docs/features/team-management/SPEC.md` — BR-5, BR-6). Server-only; never exposed via `NEXT_PUBLIC_*` or returned to a client. Missing/empty means no app admins. Not required to run `pnpm test` (injected via an explicit allow-list in tests). |

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
  (`docs/features/managed-surveys/SPEC.md`) collections each have the same
  explicit deny block, for the same defense-in-depth/documentation reason —
  all access happens server-side via `src/features/teams/server/` or
  `src/features/surveys/server/`, which use the Admin SDK and bypass these
  rules entirely.
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

Add new composite indexes or rule changes here whenever a new Firestore
query or access path is introduced, rather than relying on manually
console-created configuration.

## Skills

The workflow above is driven by six Claude Code skills under
`.claude/skills/`: `plan-feature`, `split-tasks`, `implement-task`,
`review-change`, `debug`, `security-review`. See each `SKILL.md` for its
exact procedure.
