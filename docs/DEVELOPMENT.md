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
