---
paths:
  - "app/api/**/*.ts"
  - "src/app/api/**/*.ts"
  - "src/**/*.server.ts"
  - "src/**/server/**/*.ts"
  - "src/lib/auth/**/*.ts"
  - "src/lib/encryption/**/*.ts"
  - "src/lib/firebase/**/*.ts"
  - "firestore.rules"
  - "firestore.indexes.json"
  - "firebase.json"
---

# Security and Firebase boundaries

`docs/SECURITY.md` is authoritative. These rules apply its core invariants while writing security-relevant code.

- Treat all client input as untrusted.
- Authentication does not imply authorization.
- Derive identity from verified authentication state.
- Never trust client-provided user IDs, team IDs, roles, ownership, or permissions as authorization evidence.
- Verify team membership server-side before protected team data is accessed.
- Prefer trusted server-mediated reads and writes for protected application data.
- Never rely on UI filtering for authorization.
- Keep Firebase Admin SDK server-only; never import `firebase-admin` into browser-reachable code.
- Keep Firebase initialization centralized.
- Never log survey answers, anonymous free text, sensitive request payloads, tokens, credentials, or encryption keys.
- Never persist sensitive survey values as readable plaintext; encrypt sensitive fields server-side before persistence.
- Keep encryption keys out of Firestore, git, browser-accessible configuration, and normal logs.
- Keep participation/identity data separate from anonymous response data.
- Anonymous response records must not directly contain user ID, email, employee ID, display name, or equivalent stable identity.
- Avoid metadata that materially increases correlation risk between anonymous responses and participation records.
- Never expose raw individual wellbeing responses to client code.
- Enforce the configured minimum-response threshold server-side before aggregates are exposed.
- Never use raw individual responses as a fallback when an aggregate cannot be shown.
- Admin access must not implicitly grant raw-response access.
- Never expose a secret through `NEXT_PUBLIC_*`.
