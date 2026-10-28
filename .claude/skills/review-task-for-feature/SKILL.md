---
description: |
  Independently review exactly one task implemented during an autonomous
  DevPulse feature run. Use after implement-task-for-feature. Reviews
  the actual task diff against SPEC.md, TASKS.md, project rules,
  security invariants, tests, and acceptance criteria. Returns a compact
  PASS or CHANGES_REQUIRED gate for implement-feature. Read-only: never
  implement fixes, mark tasks, start another task, or perform feature
  closeout.
name: review-task-for-feature
---

# review-task-for-feature

Review exactly one implemented task as an independent quality gate
inside an autonomous feature run. Review repository evidence, not the
implementer's summary.

## Contract

Return exactly one gate outcome:

-   `PASS` --- no Blocking or Important findings.
-   `PASS_WITH_SUGGESTIONS` --- only concrete non-blocking improvements
    remain.
-   `CHANGES_REQUIRED` --- at least one Blocking or Important finding
    remains.
-   `REVIEW_BLOCKED` --- the task boundary or required evidence cannot
    be determined reliably.

Do not modify implementation, tests, TASKS.md, or documentation.

## Principles

-   `SPEC.md` owns requirements; `TASKS.md` owns task state; the actual
    diff and code are primary implementation evidence.
-   Review only the current task. Do not expand into a feature-wide
    audit.
-   Prioritize correctness, security/privacy, requirement coverage, and
    meaningful tests over style.
-   Prefer a few high-confidence findings over speculative completeness.
-   Do not repeat checks merely to generate commentary.
-   Suggestions must have concrete value; omit subjective style
    preferences.
-   Keep the report compact so the orchestrator can continue without
    accumulating unnecessary context.

## Severity

**Blocking** - violated behavioral requirement or acceptance criterion -
authorization/privacy/security invariant violation - sensitive plaintext
or secret exposure - incorrect/destructive core behavior - required
behavior effectively untested - implementation contradicts the approved
feature contract

**Important** - realistic edge-case/reliability defect - materially weak
validation/error handling - brittle or misleading test that undermines
confidence - significant duplication/coupling likely to affect near-term
feature work - unsafe TypeScript or client/server boundary issue with
concrete impact

**Suggestion** - clear, non-blocking improvement worth considering now

## Step 1 --- Establish the exact review boundary

Read:

1.  `docs/features/<feature-id>/SPEC.md`
2.  `docs/features/<feature-id>/TASKS.md`
3.  the reviewed task, its `Covers`, verification, and acceptance
    criteria
4.  only relevant project-rule sections
5.  changed code/tests/docs
6.  actual git status/diff or the implementation handoff's recorded
    boundary

Distinguish task changes from pre-existing working-tree changes. If that
cannot be done reliably, return `REVIEW_BLOCKED` rather than guessing.

Do not trust the implementation handoff as proof; use it only to locate
evidence.

## Step 2 --- Requirement and scope review

Map every task `BR-*` to `SPEC.md`.

Verify:

-   each covered requirement is actually implemented;
-   every acceptance criterion is satisfied;
-   no required behavior is missing;
-   approved behavior was not silently changed;
-   no substantial future-task scope was implemented;
-   dependencies and task status remain coherent.

Do not invent new requirements.

## Step 3 --- Correctness and security review

Inspect realistic failure paths relevant to this task, including where
applicable:

-   invalid/missing input
-   state transitions
-   retries/idempotency/concurrency
-   unauthenticated/unauthorized/cross-team access
-   trust of client-supplied identity/team/role data
-   sensitive persistence and encryption boundaries
-   anonymous identity/correlation leakage
-   aggregation thresholds
-   sensitive logging/error output
-   secrets/configuration exposure
-   unsafe rendering of untrusted content

Use `docs/SECURITY.md` as policy. This is a task-level security check,
not a full security-review milestone. Only report issues that are
relevant to this change.

## Step 4 --- Test and engineering-quality review

Confirm tests:

-   exercise observable behavior at the strongest practical boundary;
-   would fail if the required behavior broke;
-   cover important negative paths for security-sensitive behavior;
-   use specific assertions;
-   do not mock away the behavior they claim to prove;
-   contain only small synthetic fixtures.

Inspect changed code for concrete maintainability/correctness risks:

-   duplicated domain logic
-   needless abstraction
-   excessive nesting
-   broad exception swallowing
-   unsafe `any`/assertions
-   client/server boundary violations
-   dead/debug code
-   hidden cross-feature coupling

Do not request cleanup unrelated to the task.

Run focused verification only when needed to validate review conclusions
or when the implementation handoff lacks credible evidence. Do not
automatically rerun an expensive full repository suite already evidenced
by the implementation unless the review discovers a reason to distrust
that result.

## Step 5 --- Decide the gate

Consolidate findings. Remove duplicates, speculative concerns, and
style-only comments.

A `PASS` or `PASS_WITH_SUGGESTIONS` means the orchestrator may proceed
to the next task. It does not perform feature closeout.

A `CHANGES_REQUIRED` means the orchestrator must return to the same task
and fix Blocking/Important findings before proceeding.

## Step 6 --- Compact report

Return:

``` text
REVIEW: PASS | PASS_WITH_SUGGESTIONS | CHANGES_REQUIRED | REVIEW_BLOCKED
FEATURE: <feature-id>
TASK: <task-id>

FINDINGS:
- [Blocking|Important|Suggestion] <path:line/area> — <problem>
  Affects: <BR/criterion/invariant>
  Fix: <smallest reasonable remediation>
# or: None

VERIFICATION: <commands actually run + result, or "inspection only">
COVERAGE: <BR-* and acceptance criteria reviewed>
NEXT: continue | remediate-current-task | human-decision
```

Do not fix findings. Do not update task state. Do not start another
task. Do not perform final feature documentation synchronization or a
full `security-review`.
