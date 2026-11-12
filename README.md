# DevPulse

DevPulse is an internal application for team competence, delivery and personal development. Individuals keep a private
record of their skills, goals and development conversations. Teams get a shared view of competence, roadmap, systems,
projects and anonymous pulse surveys, with privacy thresholds that keep individuals out of team-level results.

- Interface language: Norwegian (Bokmål).
- Status: an internal application in a private test environment. Account erasure is implemented but not yet operationally
  deployed. See [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md).

## Main capabilities

- **Personal development:** self-assessed skills with a personal radar, private goals, owner-driven development
  conversations, personal responsibilities and achievements.
- **Teams:** membership and access requests, a team overview, and a team administrator role per team.
- **Team competence:** a team-owned skill catalog with four-level criteria, private self-assessments shared by consent, an
  automatic team profile (at least three contributors per skill), agreed levels, and a radar.
- **Kompetanseplan:** team development plans with milestones, independent of the competence catalog.
- **Roadmap, systems and projects:** planned work per competency area, a seven-attribute system overview, and planned
  project participation.
- **Surveys:** anonymous, encrypted pulse surveys with per-survey response thresholds.
- **Administration:** superadmin registry, team management, organizational roles, and the skill-tree catalog.

## Technology

- Next.js 16 (App Router), React 19, strict TypeScript, Tailwind CSS 4.
- Firebase: Auth (client), Firestore and Auth token verification (Admin SDK, server only).
- AES-256-GCM application-level encryption for sensitive free text and survey answers.
- pnpm, Vitest, Playwright, ESLint.

## Getting started

```bash
pnpm install
cp .env.local.example .env.local   # fill in values; never commit .env.local
pnpm dev                           # http://localhost:3000
```

Full setup, environment variables, emulator use and operational scripts: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

Common commands:

```bash
pnpm dev            # development server
pnpm typecheck      # TypeScript check
pnpm lint           # ESLint
pnpm test           # Vitest unit, component and emulator-gated suites
pnpm verify:browser # Playwright browser specs (requires a running app)
```

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Users, feature inventory, key workflows |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Stack, layout, request path, feature slices, Firebase integration |
| [`docs/ROUTES.md`](docs/ROUTES.md) | Pages, navigation, redirects, API route groups and access |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Firestore collections, document IDs, validation, retention and erasure |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Authentication, authorization, privacy thresholds, encryption, erasure |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Setup, environment, emulators, scripts, operational tools |
| [`docs/TESTING.md`](docs/TESTING.md) | Test layers, guards, expected-fail cases, what is not tested |
| [`docs/KNOWN-LIMITATIONS.md`](docs/KNOWN-LIMITATIONS.md) | Verified gaps, operational limits and technical debt |
| [`docs/AI-WORKFLOW.md`](docs/AI-WORKFLOW.md) | Claude Code workflow used in this repository |
| [`docs/operations/`](docs/operations/) | Account-erasure runbook, superadmin bootstrap |
| [`docs/archive/`](docs/archive/README.md) | Historical specifications and superseded documents. Not current guidance |

Repository-wide agent instructions are in `CLAUDE.md` and `AGENTS.md`.

## Security and privacy

DevPulse handles sensitive wellbeing information. `docs/SECURITY.md` is authoritative for what the code enforces. Do not use
real employee data in development or test fixtures, do not commit secrets, and do not weaken anonymity, access control,
encryption or minimum-response protections for convenience.
