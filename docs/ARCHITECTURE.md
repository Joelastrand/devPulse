# DevPulse — Architecture

Status labels used below: **decided**, **provisional**, **open question**.

## High-level shape (decided)

```mermaid
flowchart TD
    Browser -->|HTTPS| NextJS[Next.js app]
    NextJS -->|server-side only| Boundary[Server-side application boundary]
    Boundary --> Firestore[(Firebase / Firestore)]
```

- Next.js + TypeScript, Firebase, Firestore — **decided**, not to be
  re-evaluated (see `AGENTS.md` / project constraints).
- All access to Firestore for sensitive data goes through the server-side
  boundary (Next.js server code), never directly from the browser client.
- **Decided, implemented** (Phase 2): Firestore Security Rules
  (`firestore.rules`) deny all client-SDK reads/writes unconditionally, as
  defense in depth alongside the Admin-SDK-only server boundary above — see
  `docs/DEVELOPMENT.md` ("Firestore rules and indexes") for deployment
  requirements.

## Authentication and authorization

- Firebase Authentication (email/password) is **implemented** (Phase 2; see
  `docs/features/results-dashboard/SPEC.md`). SSO/OAuth providers remain
  **not yet implemented**.
- Team authorization is enforced **server-side**: a request must prove
  membership in a team before that team's protected data is returned.
  A user authorized for Team A must not thereby gain access to Team B's
  private results — **decided invariant, implemented** in Phase 2 via a
  static, server-only, verified-email-to-`teamId` mapping (no self-service
  team selection, no Firestore `TeamMembership` collection).
- Admin access does not automatically imply access to raw individual
  responses (see `docs/SECURITY.md`). No admin role exists yet — team
  assignment is static config edited via deploy, not a runtime admin
  capability.

## Submission and dashboard boundaries (decided, implemented)

```mermaid
flowchart LR
    subgraph Public["Public / anonymous boundary"]
        Submit[Survey submission]
    end
    subgraph Protected["Protected boundary (auth required)"]
        Dashboard[Team dashboard]
    end
    Submit --> Encrypt[Application-level encryption - server-side]
    Encrypt --> Firestore[(Firestore)]
    Firestore --> Aggregate[Server-side aggregation]
    Aggregate --> Dashboard
```

- **Public/anonymous submission boundary**: accepts pulse survey answers
  without requiring the respondent's identity to be attached to the stored
  response payload.
- **Protected dashboard boundary**: requires authentication + team
  authorization; only serves aggregated results (see minimum threshold in
  `docs/SECURITY.md`), never raw individual responses, to a signed-in,
  team-assigned developer.
- Participation (who has submitted, for reminder/completion purposes) is
  stored separately from the anonymous response content itself — **decided
  invariant**, storage design is an **open question**.

## Application-level encryption boundary (decided invariant, provisional implementation)

- Sensitive survey fields are encrypted **server-side** before being written
  to Firestore, and decrypted **server-side** only when authorized
  aggregation/reporting requires it.
- Encryption keys never reach the browser, Firestore, git, or logs.
- Key management approach (e.g. Cloud KMS, Secret Manager, or another
  provider) is an **open question** — future key-management integration
  point, not yet selected.

## Aggregation

- Aggregated results are computed server-side from decrypted data and only
  the aggregate (not raw responses) is exposed to dashboards.
- Aggregates are suppressed below a configurable minimum response count
  (see `docs/SECURITY.md`).

## Open questions

- Key management provider and rotation strategy.
- Exact mechanism for separating participation records from response
  records (e.g. distinct collections, hashed linkage, no linkage at all).
- Hosting/runtime target for the server-side boundary (not decided in this
  session; no deployment work has been done).
