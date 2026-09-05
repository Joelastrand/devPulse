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

## Skills

The workflow above is driven by six Claude Code skills under
`.claude/skills/`: `plan-feature`, `split-tasks`, `implement-task`,
`review-change`, `debug`, `security-review`. See each `SKILL.md` for its
exact procedure.
