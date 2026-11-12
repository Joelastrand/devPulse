# DevPulse — Architecture (current implementation)

Source of truth: the repository. Companion documents: [`SECURITY.md`](SECURITY.md) (authorization and privacy),
[`DATA-MODEL.md`](DATA-MODEL.md) (collections and IDs), [`ROUTES.md`](ROUTES.md) (pages and API).

## 1. Stack

- Next.js 16 App Router (`next` 16.3.x), React 19, strict TypeScript, Tailwind CSS 4, `lucide-react` icons, `recharts`.
- Firebase: Auth (client SDK for sign-in and sign-up; Admin SDK for token verification), Firestore (Admin SDK only, from
  server code), emulators for local development. Production project `devpulse-nve`; its `(default)` Firestore database is
  located in `europe-north2` (Stockholm). Do not change the location: a Firestore location cannot be changed in place.
- Node cryptography (`node:crypto`) for AES-256-GCM application-level encryption.
- Tooling: pnpm, Vitest + Testing Library + jsdom (unit and component tests), Playwright (browser specs, run only via
  `pnpm verify:browser`), ESLint 9 with `eslint-config-next`.

## 2. Repository layout

```text
app/                       Next.js App Router: pages, layouts and API route handlers only
  (public)/                 sign-in, sign-up, public team page
  (survey)/                 survey participation
  (app)/                    authenticated shell: personal, team, admin pages
  api/                      JSON route handlers (thin delegates)
src/
  features/<feature>/       vertical feature slices (see §4)
  components/               shared UI primitives (ui/) and navigation shell (nav/)
  lib/                      genuinely shared infrastructure: firebase/, encryption/, theme/
browser/                    Playwright specs and emulator seed for browser verification
scripts/                    one-off and operational scripts (see DEVELOPMENT.md)
test/                       Vitest setup helpers
docs/                       this documentation set
firestore.rules             deny-all client access rules
firestore.indexes.json      composite indexes
```

`app/` holds no business logic. Pages compose feature components; route handlers parse the request and call one feature
operation.

## 3. Request path

```text
Browser (React client components, feature gateways)
   │  Authorization: Bearer <Firebase ID token>
   ▼
app/api/.../route.ts                      thin: read params, body, bearer token
   │
   ▼
src/features/<feature>/server/<op>.ts     "server-only": verify token → authorize → validate → read/write
   │   verifyIdToken (checkRevoked, erasure fence)
   │   isAppAdmin / genuine membership / teamadmin checks (read on every call)
   ▼
Firestore via Firebase Admin SDK          (src/lib/firebase/admin.ts, server-only)
```

- Server-only code imports `"server-only"`. Admin SDK imports are confined to `server/` modules and `src/lib/firebase/`.
- Client gateways (`features/<feature>/client/*-gateway.ts`) call the API routes, validate the response shape, and return
  typed results. They never hold Admin SDK material and never talk to Firestore directly.
- Errors are typed refusals (for example `forbidden`, `team_disabled`, `read_failed`, `invalid_token`,
  `erasure_in_progress`), mapped to HTTP status in the route layer. Fail-closed is the default: an unreadable authorization
  input is a refusal, never a grant.

## 4. Feature slices

Each feature under `src/features/` owns its domain rules, server operations, client gateway, components and tests. The
usual layout is `domain/` (pure rules and validation), `server/` (operations and stores), `client/` (gateway and hooks),
`components/` and `copy.ts` (Norwegian UI copy). A feature may import shared infrastructure from `src/lib` and primitives
from `src/components`. Cross-feature imports are limited to small, explicit seams. Examples: `team-owned-skills` reads the
consent-gated membership scan through `team-skills`; `teams/domain/genuine-membership.ts` is the one membership rule shared by
several owners.

Feature list (directory → purpose). Details are in [`PRODUCT.md`](PRODUCT.md).

| Directory | Purpose |
| --- | --- |
| `auth` | Sign-in and sign-up, token verification, recent-authentication check, erasure fence |
| `account-erasure` | Self-service account erasure, inventory and guard tests |
| `profiles` | Display name |
| `superadmins` | Superadmin registry and bootstrap |
| `teams` | Team records, membership, invitations, access requests, visibility, team administration |
| `team-skills` | Consent (`skillContribution`), coverage policy constants, skill needs |
| `team-owned-skills` | Canonical team competence catalog, private self-assessments, automatic and collaborative profile |
| `skill-profiles` | Personal skill self-assessment and personal radar |
| `skill-trees` | Organization skill-tree catalog, team skill progress |
| `role-profiles` | Organizational roles and assignments (reference data, no permissions) |
| `personal-goals` | Owner-only development goals |
| `personal-role-workspace` | Owner-only responsibilities and achievements |
| `development-conversations` | Owner conversations with an optional, explicitly accepted participant |
| `team-competence-plan` | Kompetanseplan: independent team development plans |
| `roadmap` | Team roadmap items per competency area |
| `team-projects` | Team delivery projects and planned participation |
| `team-systems` | Team system overview with seven attributes |
| `surveys` | Survey definitions, anonymous responses, participation, open and close lifecycle |
| `results` | Aggregated survey results with per-survey thresholds |
| `challenges` | Anonymous encrypted team challenges |
| `forum` | Team forum (behind `FEATURE_FORUM_ENABLED` for UI) |
| `home` | Authenticated and signed-out home composition |
| `demo-team` | Synthetic demo team seed and its guards |

## 5. Client/server separation

- `"use client"` components and gateways must not import `firebase-admin`, `src/lib/encryption`, or server operations.
- `NEXT_PUBLIC_FIREBASE_*` values are the public Firebase web config only. Every secret (`FIREBASE_PRIVATE_KEY`,
  `ENCRYPTION_KEY`, `FEATURE_FORUM_ENABLED`) is server-only.
- Page components (`app/`) are server components by default. Client pages use `"use client"` and gateways.

## 6. Firebase integration

- Client: `src/lib/firebase/client.ts` initializes the web SDK for Auth.
- Server: `src/lib/firebase/admin.ts` initializes the Admin SDK. It uses the service-account variables when present, and
  otherwise platform default credentials. Emulator hosts are accepted only when local and only for `demo-` projects
  (`assertAdminEmulatorSafe`).
- Firestore security rules deny all client access (see `SECURITY.md` §3).

## 7. Authentication and authorization architecture

- Token verification is centralized in `src/features/auth/server/verify-identity.ts` and checks revocation.
- Superadmin status is a registry read per request (`superadmins/{uid}`), not a token claim or an email allow-list.
- Team authorization uses the membership document for the exact `(uid, teamId)` pair, plus team status, read inside the
  operation's transaction where the write needs it.
- Account erasure adds a fence (`accountErasures/{uid}`) that every person-owned write checks inside its transaction.

The three role concepts (superadmin, team role, formal organizational role) and their boundaries are defined in
[`SECURITY.md`](SECURITY.md) §2.

## 8. Major data flows

- **Team competence, automatic profile:** members opt in (`skillContribution` on their membership) → the aggregate reads
  opted-in members and their private ratings on the server → skills with fewer than k = 3 contributors, or with suspect
  ratings, are suppressed → the client receives only levels or `insufficient_data`.
- **Team competence, collaborative profile:** a team administrator writes the agreed level per skill to
  `teamManualAssessments`. Members read it.
- **Surveys:** an administrator creates and opens a survey (one open survey per team, enforced in a transaction). A
  participant submits an encrypted response with no identity. In `authenticated` mode a uid-keyed participation record only
  blocks a duplicate. Results are aggregated on the server and suppressed below `minimumResponses`.
- **Account erasure:** the person starts it with a recent sign-in. The fence blocks their person-owned writes. The inventory
  drives deletion, anonymization and detachment step by step. Anonymous data is preserved by design.

## 8a. Encrypted persistence

Each feature that stores encrypted business content owns a `server/*-codec.ts` beside its store. The codec builds the
record context, seals on write and opens on read, and returns a value the domain parser refuses when it cannot open it.
Stores call the codec; domain validators never see ciphertext. All codecs use the v2 record envelope
(`src/lib/encryption/record-envelope.ts`). Only `src/lib/` holds the primitive. No feature repeats the cipher.

Codec placement: a codec that another feature's server code imports lives in that feature's `domain/` folder, with
`import "server-only"` at the top. Examples: `teams/domain/team-content-codec.ts`, `skill-trees/domain/skill-tree-content-codec.ts`,
`roadmap/domain/roadmap-item-content-codec.ts`, `profiles/domain/user-profile-content-codec.ts`. This keeps the cross-feature
import list of the C2 scope guard closed. Test-only fixtures for stored documents sit beside them
(`*-test-fixtures.ts`), and build fixtures with the same codec the production read path opens.

Keyed blind indexes (for matching without a plaintext value) use `src/lib/encryption/blind-index.ts`: one HKDF-derived key per
purpose, HMAC-SHA-256. Current purposes are `team-invitation-email` and `roadmap-owner-ref`. A new purpose must be added to
that module's union type and documented in [`DATA-MODEL.md`](DATA-MODEL.md) §11.

## 9. Shared components

- `src/components/ui/` holds presentation primitives (`Button`, `Card`, `Badge`, `Alert`, `Container`, `PageShell`,
  `ChartFrame`, dashboard primitives, `Icon`, `SkipLink`). They carry no business logic.
- `src/components/nav/` holds the shell: `AppShell` (sidebar from `md`, drawer below), `PublicHeader`, `PersonalNav`,
  `TeamContext`, `AccountMenu`, and `copy.ts`.
- Navigation items are defined in code (`navGroupsFor` in `AppShell.tsx`, `TeamRouteNav`). Visibility of admin items
  follows `state.isAdmin` from `/api/me`.

## 10. Visual design

Colour and typography use Tailwind tokens. The theme module `src/lib/theme/` applies light or dark mode based on the system
preference (`prefers-color-scheme`). Chart colours and dashboard layout are defined in the UI primitives. The earlier design
documents are archived at `docs/archive/design/`; the implementation is the reference.

## 11. External dependencies

- Firebase: Auth, Firestore, and the local emulators.
- Fonts: Geist and Geist Mono, loaded with `next/font/google` in `app/layout.tsx`.
- No analytics or error-reporting SDK is present (grep for common analytics and error-reporting packages found none).

## 12. Known architectural debt

See [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) §4.
