---
description: |
  Perform a focused DevPulse security and privacy review of a feature,
  milestone, architecture change, or security-sensitive implementation.
  Use when the user asks for a security review, privacy review, threat
  assessment, milestone security check, or says "security-review",
  "review security", "review privacy", or similar. Reviews repository
  evidence against DevPulse security invariants and produces prioritized
  findings. DO NOT use for routine review of every small change; use
  `review-change`. DO NOT use to implement a feature; use
  `implement-task`. DO NOT use to investigate one concrete defect; use
  `debug`. DO NOT invent new product requirements without identifying
  them as proposals.
name: security-review
---

# security-review

Perform one focused security and privacy review: find realistic ways the
reviewed scope could violate DevPulse's security, privacy, anonymity, or
access-control guarantees. This is milestone-oriented, not mandatory
ceremony for every small task.

## Principles

- `docs/SECURITY.md` is the authoritative security policy — don't copy it,
  use it to drive the review.
- Review actual repository evidence, not summaries. Prioritize realistic
  attack paths over theoretical ones.
- Authentication is not authorization. Admin capability doesn't imply
  access to raw sensitive data. Provider encryption-at-rest doesn't
  replace required application-level encryption.
- Treat wellbeing responses and anonymous free text as highly sensitive;
  minimize their collection, retention, exposure, and correlation.
- Findings must be concrete, evidence-based, and actionable. Distinguish
  confirmed defects from risks, review gaps, and design questions — never
  silently treat a known risk as accepted.

## Finding severity

- **Critical** — can realistically expose sensitive data, break
  anonymity, bypass authorization, or expose secrets/keys.
- **High** — a significant weakness with a credible exploitation/exposure
  path.
- **Medium** — a meaningful weakness needing extra conditions or with
  limited impact.
- **Low** — a concrete defense-in-depth improvement with limited direct
  impact.

Don't assign severity from theoretical possibility alone.

## Step 1 — Scope, assets, and trust boundaries

Identify the exact scope (a feature, milestone, authentication/
authorization, survey submission, aggregation/results, encryption
boundary, Firebase access, anonymous participation, or a specific diff).
Read `docs/SECURITY.md`, relevant `SPEC.md`/`TASKS.md`, relevant
`docs/ARCHITECTURE.md`/`docs/DATA-MODEL.md`, and relevant implementation,
tests, configuration, and Firestore rules — only what the boundary needs.

List the protected assets in scope (survey dimension scores, anonymous
free text, team membership, participation state, aggregate results, user
identity, auth/session data, encryption keys, encrypted DEKs, Firebase
credentials, admin capabilities) and who should/shouldn't access each.

Identify where data crosses trust boundaries (browser→server,
unauthenticated survey flow→server, authenticated user→server,
server↔Firestore, server→key-management, server→results UI,
application→logs/error monitoring, test/dev→production-like interfaces).
Never assume client-supplied identity, team, role, or authorization data is
trustworthy.

## Step 2 — Authentication, authorization, and anonymity

**Authorization:** where relevant, verify protected result access requires
authentication; authorization and team membership are checked server-side;
multi-team users get only what they're entitled to; Team A can't reach
Team B's private data; client-supplied identifiers alone don't determine
authorization; admin roles use least privilege and don't automatically
grant raw response access; denied paths are tested. Look specifically for
insecure direct-object-reference access via team/survey/response IDs.

**Anonymity:** verify anonymous response records don't directly contain
`userId`, email, employee ID, display name, or an equivalent stable
identity, and review whether identity is still reconstructable via
participation records, exact timestamps, document/request IDs, logs,
IP-derived metadata, analytics, ordering, small cohorts, or joinable
identifiers. The bar is meaningful resistance to re-linking, not just "no
name field" — flag correlation paths by realistic risk.

## Step 3 — Sensitive-data encryption and storage boundaries

**Encryption:** verify plaintext isn't persisted to Firestore; encryption
happens server-side before persistence and decryption only in trusted
server-side code; keys never reach browser code, Firestore, git, or normal
logs; encrypted records carry only necessary metadata; key
identifiers/versions don't themselves leak sensitive information. If
encryption/key management isn't implemented yet, review the
design/interfaces without pretending runtime guarantees already exist —
distinguish design readiness from implemented protection.

**Firestore boundaries:** determine whether sensitive collections are
reached via client SDK, server/Admin SDK, Firestore security rules, or a
combination, and verify that model can't let a client bypass server-side
authorization, encryption, threshold enforcement, or anonymity controls.
Check read/write permissions, query paths, predictable IDs, unintended
enumeration, cross-team access, direct access to encrypted raw responses,
participation-data exposure, and dev/test rules accidentally becoming
permissive in production. Don't assume rules exist or are effective
without evidence.

## Step 4 — Aggregation and privacy

Verify individual wellbeing scores are never displayed; aggregates enforce
the configured minimum group size at a trusted server boundary (per
`docs/SECURITY.md`); filters can't be combined to shrink a cohort below
threshold; repeated queries can't reveal an individual's contribution via
differencing; historical/team slicing doesn't deanonymize small groups;
free text isn't exposed as if aggregation made it anonymous. Treat
threshold enforcement as a privacy control, not just a UI rule.

## Step 5 — Logging, secrets, and data lifecycle

**Observability:** check whether sensitive values (survey payloads, free
text, keys, tokens) can reach application logs, browser console, request
logs, analytics, tracing, exception messages, error-monitoring payloads, or
debug output; prefer non-sensitive operational metadata. Verify
client-facing errors don't leak secrets, keys, stack details, internal
document contents, or authorization-sensitive information.

**Secrets/configuration:** check for committed credentials, API secrets,
private/encryption keys, accidentally public env vars, server secrets in
client bundles, unsafe example `.env` values, or verbose config logging.
Never print a suspected secret's value — identify its location and type
only.

**Data minimization/retention:** check whether the scope collects/stores
more than necessary (identity fields, timestamp precision, request
metadata, participation data, raw encrypted responses, free text, derived
aggregates) against defined retention/deletion needs; flag data kept "just
in case." Real employee data must never appear in dev/test fixtures.

## Step 6 — Abuse, integrity, and tests as evidence

Where relevant to current scope and product stage, consider repeated/
automated submission, unauthorized participation, replay, tampering,
malformed payloads, DoS amplification, aggregate manipulation, future
challenge-voting manipulation, and unsafe free-text rendering — don't
demand enterprise-scale controls for a small PoC without credible need.

Inspect tests for explicit negative coverage: unauthenticated access,
unauthorized/cross-team access, threshold violations, invalid payloads,
identity leakage, the encryption persistence boundary, and sensitive
logging where testable. Tests should prove forbidden behavior fails, not
just that allowed behavior succeeds — don't accept mocks that bypass the
boundary they claim to test.

## Step 7 — Diff, verification, findings, and outcome

If reviewing an implementation change, inspect `git status --short`/`git
diff` and run focused existing tests plus the repository's actual `npm
test`/lint/typecheck/build commands where they provide useful evidence —
only scripts that exist, only results you actually ran. Static inspection
and passing tooling don't prove security by themselves.

For each finding capture: severity, affected asset, evidence/location,
attack or privacy-failure path, impact, smallest reasonable remediation,
and the relevant `docs/SECURITY.md` invariant. Remove duplicates, generic
best-practice noise without a concrete path, unsupported speculation, and
out-of-scope/style-only items. Record an area that couldn't be verified as
an explicit **review gap**, not a confirmed vulnerability.

Decide outcome: `PASS` (no material findings or unresolved gaps), `PASS
WITH RISKS` (only accepted design risks, Low findings, or non-blocking
gaps), or `CHANGES REQUIRED` (any unresolved Critical/High/Medium
finding). Risk acceptance is a user/project decision, never silent.

## Fix policy and reporting

Review, don't remediate — don't modify implementation while finding
issues unless the user explicitly asked for review-and-fix. Never make a
security fix that changes product behavior, authorization policy,
retention, anonymity guarantees, or architecture without making that
decision explicit. A concrete defect needing investigation goes to
`debug`; a new product requirement discovered during review goes back to
`plan-feature` rather than being silently added.

Report, in order: **Outcome**; **Findings** (highest to lowest severity,
or `No material security or privacy findings.`), each as:

```
[Critical|High|Medium|Low] <short title>
Asset: <protected asset>
Location: <path:line or boundary>
Invariant: <relevant security rule>
Path: <how the failure/exposure can occur>
Impact: <concrete consequence>
Remediation: <smallest reasonable correction>
```

then **Review gaps** (or `None`), **Verification** (commands actually run
and results), and **Scope** (what was reviewed and what was intentionally
excluded).

Do not start implementation or another review. Stop after the security
review.
