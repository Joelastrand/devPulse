---
description: |
  Implement exactly one DevPulse task as part of an autonomous feature
  run. Use when implement-feature delegates the next task, or when the
  user explicitly wants one task implemented with feature-run semantics.
  Optimized for low-noise, resumable execution: reads repository state,
  implements one task, performs targeted verification and a self-check,
  updates TASKS.md, and returns a compact handoff for
  review-task-for-feature. DO NOT plan features or split tasks. DO NOT
  start a second task. DO NOT perform the independent review itself.
name: implement-task-for-feature
---

# implement-task-for-feature

Implement exactly one eligible task completely, leaving repository state
cleanly described and ready for an independent task review. Optimize for
autonomous feature execution: repository files are the source of truth;
conversation history is not.

## Contract

Inputs are repository state plus, optionally, an explicit `<feature-id>`
and `<task-id>`.

Produce exactly one of:

-   `IMPLEMENTED` --- the task is implemented, verified, marked `Done`,
    and ready for independent review.
-   `BLOCKED` --- a human/product/architecture/security decision or
    unsafe repository state prevents reliable completion.
-   `FAILED` --- implementation or verification could not be completed
    after reasonable focused attempts.

Never start another task.

## Principles

-   `SPEC.md` owns feature requirements; `TASKS.md` owns task state.
-   Work on exactly one task. Resume the single `In Progress` task
    before selecting another `Ready` task.
-   Prefer the smallest complete vertical change.
-   Make ordinary implementation decisions autonomously when they
    preserve the approved external contract and project rules.
-   Stop for decisions that materially change product behavior, scope,
    architecture, security/privacy policy, data ownership, or a public
    contract.
-   Use test-first development where it creates a meaningful red/green
    loop, especially at server/API, domain, authorization, validation,
    persistence, aggregation, encryption, and regression-prone
    boundaries.
-   Never weaken, skip, or delete a valid test to make verification
    pass.
-   Never reset, discard, overwrite, or silently absorb pre-existing
    user changes.
-   Keep output compact. Durable state belongs in repository files, not
    the chat.

## Step 1 --- Load only the required context

Read:

1.  `docs/features/<feature-id>/SPEC.md`
2.  `docs/features/<feature-id>/TASKS.md`
3.  the selected task and its referenced `BR-*` requirements
4.  only relevant sections of `docs/ARCHITECTURE.md`,
    `docs/SECURITY.md`, `docs/DATA-MODEL.md`, and repository
    instructions
5.  the smallest relevant code/test area

Do not reread unrelated feature history or scan the whole repository
without a specific reason.

Select the task in this order:

1.  the single `In Progress` task, if one exists;
2.  an explicitly delegated eligible task;
3.  otherwise the first unblocked `Ready` task whose dependencies are
    `Done`.

If multiple tasks are `In Progress`, stop with `BLOCKED`.

Validate that the task exists, dependencies are satisfied, all `Covers`
references exist in `SPEC.md`, acceptance criteria are actionable, and
no material decision is missing.

## Step 2 --- Establish the task boundary

If the task is `Ready`, mark it `In Progress` and update TASKS.md
counts.

Capture enough git state to distinguish this task from pre-existing
changes:

-   `git status --short`
-   `git rev-parse HEAD` when the tree is dirty, the task is likely to
    span multiple commits, or the boundary would otherwise be ambiguous

Never clean the tree on the user's behalf.

Inspect existing patterns at the highest useful observable boundary.
Prefer extending established feature-local patterns over introducing new
abstractions.

## Step 3 --- Establish RED when useful

Choose the highest useful observable boundary:

1.  server/API
2.  application/domain
3.  component/user-visible behavior
4.  focused lower-level logic only when no stronger boundary exists

When a meaningful failing test can express the missing behavior:

-   add the smallest useful test;
-   run the narrowest command that executes it;
-   confirm failure for the expected behavioral reason.

If it unexpectedly passes, determine whether behavior already exists,
the test is insufficient, or the task is stale before changing
production code.

Do not force artificial TDD onto trivial presentation/configuration
work.

## Step 4 --- Implement the smallest complete solution

Implement only the selected task and the requirements it covers.

Follow repository architecture, TypeScript, testing, security, and
data-model rules. In particular:

-   validate untrusted runtime data at trust boundaries;
-   preserve client/server boundaries;
-   enforce authorization server-side where required;
-   never expose server secrets or encryption keys to client code;
-   never persist prohibited sensitive plaintext;
-   never add direct identity to anonymous response records;
-   never log sensitive payloads;
-   avoid speculative shared abstractions and future-task work.

Minimal supporting work is allowed only when inseparable from the
selected task. If substantial unplanned work is required, stop with
`BLOCKED` and identify the planning gap.

## Step 5 --- Verify and self-check

Run verification in increasing scope:

1.  the new/changed focused test;
2.  directly affected tests;
3.  relevant typecheck/lint/build checks where available and useful.

During an autonomous feature run, do not repeatedly run an expensive
full repository suite after every small task when targeted evidence is
strong and the repository provides a later feature-level gate. However:

-   run any check explicitly required by the task;
-   run broader checks when the change has broad compile/runtime impact;
-   never mark a task complete with a known task-caused failure.

Refactor only changed code where doing so clearly improves the current
task.

Inspect `git status --short` and the task diff. Confirm:

-   every task-caused change belongs to the task;
-   no secret, sensitive fixture, debug output, or accidental file was
    introduced;
-   no approved requirement/security invariant was weakened;
-   no future-task behavior leaked in;
-   tests exercise meaningful observable behavior.

Check every task acceptance criterion and every covered `BR-*`
individually.

## Step 6 --- Update durable state

Update authoritative documentation only when this task establishes
durable information such as an architecture decision, security
constraint, data-model change, public contract, configuration
requirement, or developer command.

Mark the task `Done` only when its behavior, acceptance criteria,
task-required verification, diff inspection, security obligations, and
relevant documentation are complete. Update TASKS.md summary counts
without changing stable IDs or historical task meaning.

If completion criteria are not met, leave the task `In Progress`.

## Step 7 --- Compact handoff

Return a compact structured handoff and stop:

``` text
RESULT: IMPLEMENTED | BLOCKED | FAILED
FEATURE: <feature-id>
TASK: <task-id> — <title>
COVERS: <BR-*>
CHANGED: <paths, concise>
TESTS: <added/changed tests>
VERIFICATION: <commands + pass/fail, concise>
DOCS: <updated paths or none>
PREEXISTING_CHANGES: <none or concise description>
REVIEW_BOUNDARY: <commit/diff boundary or concise description>
NOTES: <only information needed by review/orchestrator>
```

Do not invoke `review-task-for-feature` yourself. Do not start another
task.
