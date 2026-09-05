---
description: |
  Review one implemented DevPulse task against its SPEC.md, TASKS.md,
  project rules, security invariants, tests, and actual git diff. Use
  when the user asks to review, inspect, validate, or code-review an
  implemented task or change, or says "review change", "review task",
  "code review", or similar. Produces prioritized findings and verifies
  requirement coverage without starting new feature work. DO NOT use to
  define requirements; use `plan-feature`. DO NOT use to split work into
  tasks; use `split-tasks`. DO NOT use as the normal implementation
  workflow; use `implement-task`. DO NOT use to investigate an unrelated
  concrete defect; use `debug`.
name: review-change
---

# review-change

Review exactly one implemented task or clearly bounded change: is it
correct, complete, secure, maintainable, and consistent with the approved
feature contract? Review the actual implementation and diff, not a summary
of it.

## Principles

- `SPEC.md` owns requirements; `TASKS.md` owns task status. The git diff is
  the primary evidence of what changed.
- Prioritize correctness and security over style. Don't invent
  requirements, expand scope, or recommend speculative refactoring.
- Distinguish defects from optional improvements. A review with no
  meaningful findings is a valid outcome.

## Finding severity

- **Blocking** — must be resolved before the change is complete: a
  violated behavioral requirement, a security/privacy invariant violation,
  authorization bypass, sensitive plaintext stored where prohibited, data
  exposure, destructive behavior, incorrect core behavior, an unsatisfied
  acceptance criterion, or a test suite that looks green while required
  behavior is untested.
- **Important** — works but has a meaningful quality, reliability,
  maintainability, or edge-case problem: missing edge-case handling, weak
  validation, significant duplication, a brittle test, misleading error
  handling, or coupling likely to cause near-term problems.
- **Suggestion** — a non-blocking improvement with clear value. Don't fill
  the review with subjective style preferences.

## Step 1 — Establish scope and evidence

Identify the feature, task ID, and expected change boundary. Read
`docs/features/<feature-id>/SPEC.md`, `TASKS.md`, relevant sections of
`docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, and the
changed code/tests/docs. Inspect `git status --short` and `git diff`
(compare to the task's recorded starting commit when useful); read
relevant committed files when the working-tree diff alone isn't enough.
Distinguish the reviewed task's changes from pre-existing working-tree
changes, generated files, and unrelated modifications — don't modify files
during review, and report the ambiguity if the boundary can't be determined
reliably.

## Step 2 — Verify requirement coverage

Read the task's `Covers`, `Outcome`, `Verification`, and `Acceptance
criteria`, and map each `BR-*` back to `SPEC.md`. Check: every covered
requirement is actually implemented (behavior matches, not merely
resembles); acceptance criteria are satisfied; nothing required is missing
or contradicts another requirement; the approved contract wasn't silently
changed; no substantial future-task scope was included.

## Step 3 — Security and privacy

Using `docs/SECURITY.md` as the authoritative policy, check what's
relevant to this change: server-side authorization, team isolation,
anonymous identity separation, Firestore access, application-level
encryption, key exposure, sensitive logging/error reporting, the minimum
aggregation threshold, personal data handling, test fixtures,
secrets/configuration, and abuse/rate-limiting. For survey-related changes
ask specifically: can sensitive values reach Firestore as plaintext; can
client code obtain keys or server-only credentials; does an anonymous
response contain `userId`, email, employee ID, display name, or an
equivalent; can participation and response records be trivially joined;
can timestamps/metadata undermine anonymity; can Team A reach Team B's
results; can results appear below the minimum threshold; can sensitive
values reach logs/analytics/traces/error monitoring; can an admin reach raw
responses unnecessarily; do tests/fixtures contain realistic employee data.
Only report checks relevant to this change.

## Step 4 — Correctness, tests, and quality

**Behavior:** check validation, invalid state transitions, missing data,
duplicate requests, retries/idempotency, concurrency, unauthorized/
forbidden access, empty states, boundary values, and error propagation
where relevant — focus on scenarios that could realistically break the
task's contract, not manufactured edge cases.

**Tests:** confirm they exercise observable behavior, cover important
behavioral requirements and security-sensitive rules, would actually fail
if the implementation broke, use specific assertions, don't mock away the
behavior under test, and contain no sensitive/realistic employee data.
Don't require tests for trivial presentation details the spec doesn't call
for, and don't recommend low-value coverage-only tests.

**Engineering quality:** look for unnecessary complexity, duplicated
domain logic, excessive nesting, misleading names, dead code, broad
exception swallowing, unsafe type assertions/`any`, accidental
client/server boundary violations, needless abstraction, or inconsistency
with established patterns. Prefer simple code over speculative reusability.

## Step 5 — Documentation and verification

Check whether the change established or altered durable information
(architecture decision, security invariant, data model, dev command,
config requirement, public contract) that existing docs should reflect;
prefer updating an authoritative doc over creating a new one. Run the
repository's actual test/lint/typecheck/build commands when they provide
evidence the review needs — only claim a result you actually ran. A
passing build/lint doesn't by itself prove feature correctness.

## Step 6 — Consolidate, decide outcome, and report

Remove duplicate, speculative, style-only, or out-of-scope findings. For
each remaining finding give: severity, file/location, the concrete
problem, the requirement/invariant affected, why it matters, and the
smallest reasonable remediation. Prefer a few high-confidence findings over
a long noisy list.

Decide outcome: `PASS` (no Blocking/Important findings, no meaningful
suggestions), `PASS WITH SUGGESTIONS` (only Suggestions remain), or
`CHANGES REQUIRED` (any Blocking or Important finding remains). Passing a
review never marks a task `Done` — that stays owned by
`implement-task`/`TASKS.md`.

Report, in order: **Outcome**; **Findings** (highest to lowest severity, or
`No material findings.`), each as:

```
[Blocking|Important|Suggestion] <short title>
Location: <path:line or area>
Affects: <BR-id, acceptance criterion, invariant, or quality>
Problem: <concrete issue>
Remediation: <smallest reasonable fix>
```

then **Verification** (commands actually run and results) and
**Coverage** (task and behavioral requirements reviewed).

## Fix policy

Review, don't implement. A trivial, unambiguous correction may be made
only if the user explicitly asked for review-and-fix; if a fix would
change product behavior, architecture, security policy, or task scope,
don't make it during review — recommend `debug` for a defect needing
investigation. If fixes are made, rerun affected verification and clearly
separate findings from the changes made during review.

Do not start another task or invoke `implement-task` automatically. Stop
after the review.
