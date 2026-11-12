# DevPulse — Development

Use `package.json` as the source of truth for scripts. Use pnpm for every repository command.

## 1. Prerequisites

- Node.js 24 or newer. The repository sets no `engines` field. The seed scripts rely on native TypeScript type stripping.
- pnpm (the version pinned by `packageManager` in `package.json`).
- For Firebase-backed local work: the Firebase emulators (Auth on `127.0.0.1:9099`, Firestore on `127.0.0.1:8080`, from
  `firebase.emulator.json`). Install `firebase-tools` separately; it is not a repository dependency.

## 2. Setup

```bash
pnpm install
cp .env.local.example .env.local   # then fill in values; never commit .env.local
pnpm dev
```

Open `http://localhost:3000`. Never commit `.env.local` or any credential.

## 3. Environment configuration

| Variable | Read by | Required for | Notes |
| --- | --- | --- | --- |
| `ENCRYPTION_KEY` | `src/lib/encryption/encryption.ts` (server) | Any write of encrypted content: surveys, challenges, forum, conversations, role workspace | Base64 of exactly 32 bytes. Generate with `openssl rand -base64 32`. A missing or malformed key throws; there is no plaintext fallback |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | `src/lib/firebase/admin.ts` (server only) | Firestore access from server code | If unset, the Admin SDK uses platform default credentials. The demo seed does not fall back and requires all three |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | `src/lib/firebase/client.ts` | Sign-in and sign-up | Public web configuration, not secrets |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` | `src/lib/firebase/client.ts` | Local Auth emulator | Public, local only |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` | Admin SDK (read by the SDK) | Local emulator | Accepted only for loopback hosts and `demo-` projects |
| `FEATURE_FORUM_ENABLED` | `src/features/forum/server/is-forum-enabled.ts` (server only) | Forum UI | Exactly `"true"` enables the forum thread page. A UI switch, not a security control |
| `DEVPULSE_EMULATOR_PROJECT` | browser verification and emulator tooling | Playwright and emulator scripts | Must be a `demo-` project |
| `DEVPULSE_VERIFY_BASE_URL` | browser verification (`browser/playwright.config.ts`) | Playwright | Base URL of the running app |

`APP_ADMIN_EMAILS` is obsolete. No code reads it. Superadmin status comes only from the `superadmins` registry.

## 4. Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve a production build |
| `pnpm lint` | ESLint 9 with the Next.js config |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, one run over `src/**`, `app/**` and `scripts/**/*.test.ts` (about 9.5 min). Use only at milestones |
| `pnpm test:quick --files <paths>` | Task-scoped: tests for the named files (import graph), plus the security guards. Requires `--files` or `--changed`. Not complete verification (`TESTING.md` §1a) |
| `pnpm test:standard --files <paths>` | quick, plus every test in the feature folders the files touch, typecheck, and ESLint on the named files |
| `pnpm test:full` | Full Vitest suite, typecheck and lint. Warns when the emulator is not configured |
| `pnpm test:emulator` | Emulator suites only. Fails when no Firestore emulator answers |
| `pnpm verify:browser` | Playwright specs in `browser/` (see `TESTING.md`) |
| `pnpm seed:demo-team` | Demo-team seed CLI (dry-run unless its flags are given) |

Other scripts are run directly with Node (see §6).

## 5. Emulators

1. Start the Firebase emulators for Auth and Firestore using `firebase.emulator.json`.
2. Use a `demo-` project id so the Admin SDK accepts emulator hosts.
3. Run `pnpm dev` with the emulator host variables set.

Emulator-backed tests (`*.emulator.test.ts`) are included in the default `pnpm test` run. They use `describe.skipIf` and
skip unless `FIRESTORE_EMULATOR_HOST` and `DEVPULSE_EMULATOR_PROJECT` are set. See `TESTING.md`.

## 6. Scripts and operational tools

Each tool below has its own guard. Read the file's header before running it.

| Tool | Command | Guard | Use |
| --- | --- | --- | --- |
| Demo team seed | `pnpm seed:demo-team -- …` (see the CLI header) | Dry-run by default. Writes need `--write` and `--confirm=<projectId>:demo-team`. Refuses non-demo projects | Synthetic demo data only |
| Demo conversations | `node --conditions=react-server --import ./src/features/demo-team/register-ts-resolver.mjs --env-file-if-exists=.env.local scripts/seed-demoteam-conversations.ts` | Same demo guard | Synthetic owner conversations |
| Superadmin bootstrap | `node --env-file=.env.local scripts/bootstrap-superadmin.ts --project <id> --email <owner>` | Dry-run by default. `--apply --confirm <id>` writes | One-time owner bootstrap. See `docs/operations/superadmin-bootstrap.md` |

Retired and removed from the repository: the legacy demo seed (`seed-demoteam.mjs`, superseded by `pnpm seed:demo-team`), the
disposable-data reset, and the one-off competence-plan migration and role-expectation cleanup. Their history is in git.

Operational rules (from `CLAUDE.md`): do not deploy, do not change cloud infrastructure, and do not run anything against a
real project without an explicit request. Demo data must never use real employee or wellbeing data.

## 7. Repository conventions

- Vertical feature slices under `src/features/<feature>/`. Shared code only in `src/lib/` or `src/components/`.
- Server-only modules import `"server-only"`. Route handlers stay thin.
- Norwegian copy lives in each feature's `copy.ts` or `*-copy.ts`.
- Firestore document IDs that encode relations (`{uid}__{teamId}`) are built only by the domain helper for that collection.
- Update the relevant document in `docs/` when a product, architecture, security or data contract changes.

## 8. Before you finish a change

Run the checks that match the change, then inspect the diff.

- Any code change: `pnpm typecheck` and the focused tests for the feature.
- Security-sensitive change: also the guard tests named in `TESTING.md` §4.
- UI change: `pnpm lint`, and `pnpm verify:browser` when the change affects a page the specs cover.
