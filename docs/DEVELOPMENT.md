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

9. Add at least one verified-email → `teamId` entry to
   `TEAM_ASSIGNMENTS` in `src/features/teams/domain/team-assignments.ts`
   before exercising the results dashboard end-to-end against real
   Firestore — it ships empty and no user can be resolved to a team without
   a manual entry there.

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

## Firestore rules and indexes

`firestore.rules` and `firestore.indexes.json` (both referenced from
`firebase.json`) are the source of truth for Firestore access control and
required composite indexes — both must be deployed together:

```
firebase deploy --only firestore:rules,firestore:indexes
```

- **`firestore.rules`** denies all Firestore client-SDK reads and writes
  unconditionally, on every collection, including `pulseSurveyResponses`.
  This app's own code never needs client-SDK Firestore access to be
  allowed: all server code (`src/lib/firebase/admin.ts`, used by
  `submit-pulse-survey.ts` and `get-dashboard.ts`) reads/writes Firestore
  through the Firebase **Admin** SDK, which always bypasses Security Rules
  — the client SDK (`src/lib/firebase/client.ts`) is Auth-only in this
  codebase and never calls Firestore. Without this file deployed, the
  browser's public `NEXT_PUBLIC_FIREBASE_*` web config would be enough for
  any client to query `pulseSurveyResponses` directly, bypassing this
  feature's server-side team scoping, open-period exclusion, and minimum-
  response threshold entirely (`docs/SECURITY.md` invariants 8–11) — found
  in `security-review` of `docs/features/results-dashboard/`. Do not
  loosen this file to permit client reads/writes without an explicit,
  reviewed decision to introduce direct client Firestore access.
- **`firestore.indexes.json`** declares the composite index on
  `pulseSurveyResponses` (`teamId` ascending, `period` ascending) the
  results dashboard's read path (`src/features/results/server/
  get-dashboard.ts`) depends on: it filters by `teamId ==` together with
  `period in [...]`, a compound-filter shape Firestore does not cover with
  automatic single-field indexes. Without this index deployed, the
  dashboard endpoint (`GET /api/results`) fails closed with a
  read-failure response against a real Firestore project.

Add new composite indexes or rule changes here whenever a new Firestore
query or access path is introduced, rather than relying on manually
console-created configuration.

## Skills

The workflow above is driven by six Claude Code skills under
`.claude/skills/`: `plan-feature`, `split-tasks`, `implement-task`,
`review-change`, `debug`, `security-review`. See each `SKILL.md` for its
exact procedure.
