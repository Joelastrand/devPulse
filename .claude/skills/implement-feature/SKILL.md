---
description: |
  Autonomously implement an already planned and task-split DevPulse
  feature from SPEC.md and TASKS.md with minimal user interaction.
  Orchestrates one task at a time using implement-task-for-feature
  semantics, independently reviews each task using
  review-task-for-feature semantics, remediates review findings,
  checkpoints durable repository state, and finishes with feature-level
  verification and security review when relevant. Use only after
  plan-feature and split-tasks have produced an approved,
  implementation-ready feature. Stop for material human decisions;
  otherwise continue autonomously until complete or safely blocked.
name: implement-feature
---

# implement-feature

Implement one approved, task-split feature end-to-end with minimal user
interaction.

This is an orchestration workflow. It does not weaken the boundaries of
`implement-task-for-feature` or `review-task-for-feature`: exactly one
task is implemented and reviewed at a time, and repository files remain
the durable source of truth.

## Goal

After the user has completed planning and task splitting, continue
independently through ordinary implementation decisions until:

-   all feature tasks are implemented and independently reviewed;
-   feature-level verification passes;
-   required durable documentation is synchronized;
-   a focused feature-level security/privacy review has passed when the
    feature warrants one;

or until a material decision/blocker genuinely requires the user.

## Preconditions

Identify `<feature-id>` and read:

-   `docs/features/<feature-id>/SPEC.md`
-   `docs/features/<feature-id>/TASKS.md`
-   repository instructions and the documentation map if one exists

Before coding, require:

-   the spec is approved/implementation-ready;
-   behavioral requirements have stable `BR-*` IDs;
-   no material open question blocks implementation;
-   TASKS.md exists and maps the in-scope requirements;
-   zero or one task is `In Progress`;
-   task dependencies are coherent.

If these conditions are not met, stop. Do not silently plan, rescope, or
regenerate tasks.

## Autonomy policy

Proceed without asking the user about:

-   local implementation details;
-   naming/internal structure consistent with existing patterns;
-   which existing pattern to extend when one is clearly established;
-   test organization;
-   small refactors inside the current task;
-   ordinary error handling already implied by the spec/project rules.

Stop and ask for a decision only when continuing would require one of:

-   changing approved user-visible behavior or scope;
-   choosing between materially different product behaviors;
-   introducing/changing an architecture contract not already implied by
    project rules;
-   changing authorization, privacy, anonymity, retention, encryption,
    or other security policy;
-   accepting a known material security/privacy risk;
-   destructive handling of ambiguous pre-existing user changes;
-   substantial unplanned work that means TASKS.md is no longer a
    reliable plan;
-   an unresolved blocker that cannot be fixed within the current
    approved contract.

When stopping, state the smallest exact decision needed and where it
should be recorded.

## State and context discipline

Treat repository state as external memory.

At the start of every task cycle, reload the relevant task state from
SPEC.md and TASKS.md. Do not rely on remembered status from earlier
conversation turns.

Keep active context narrow:

-   current task and covered requirements;
-   directly relevant code/tests;
-   relevant architecture/security/data-model sections;
-   unresolved findings from the current task review.

Do not carry old test output, old diffs, completed-task implementation
details, or resolved review discussion forward unless they affect the
next task.

After each completed task, TASKS.md and authoritative docs must contain
everything a fresh session would need to continue.

## Main loop

Repeat until no unfinished task remains.

### 1. Select exactly one task

Selection order:

1.  resume the single `In Progress` task;
2.  otherwise choose the first unblocked `Ready` task whose dependencies
    are `Done`.

Never have more than one task `In Progress`.

### 2. Implement the task

Execute the full `implement-task-for-feature` workflow for that task.

Expected result:

-   `IMPLEMENTED` → continue to independent review;
-   `BLOCKED` → stop the feature run and report the required
    decision/action;
-   `FAILED` → make at most one additional focused implementation
    attempt when the failure has a clear technical cause inside the
    approved task; otherwise stop.

Do not start another task before the current task passes review.

### 3. Independently review the task

Execute the full `review-task-for-feature` workflow against the actual
repository evidence.

Handle the gate:

-   `PASS` → proceed;
-   `PASS_WITH_SUGGESTIONS` → record only suggestions that materially
    help later feature work; otherwise proceed;
-   `REVIEW_BLOCKED` → try once to establish the missing diff/evidence
    boundary; if still ambiguous, stop;
-   `CHANGES_REQUIRED` → remediate the same task.

### 4. Remediate review findings

For `CHANGES_REQUIRED`:

1.  reopen the same task logically; do not select another task;
2.  fix only Blocking/Important findings within the approved task/spec;
3.  rerun affected verification;
4.  inspect the remediation diff;
5.  rerun `review-task-for-feature`.

Allow at most **two review-remediation cycles per task**. If
Blocking/Important findings remain after that, stop and report them
rather than entering an unbounded loop.

If remediation requires a product/architecture/security-policy decision,
stop immediately for that decision.

### 5. Checkpoint and continue

Once the task review passes:

-   ensure TASKS.md accurately records the completed task and summary
    counts;
-   preserve useful durable notes only when future tasks genuinely need
    them;
-   discard conversational detail that is already represented by
    repository state;
-   select the next task.

Every three completed tasks, or after a task with broad
architectural/security impact, run a lightweight milestone gate:

-   inspect TASKS.md consistency and requirement coverage;
-   run broader repository checks if accumulated changes make them
    useful;
-   confirm no known task-level Blocking/Important finding remains.

This is a checkpoint, not a new planning/review ceremony.

## Feature completion gate

When all tasks are `Done`, do not immediately declare success.

### 1. Requirement coverage

Verify every in-scope `BR-*` in SPEC.md is covered by completed tasks
and exists in the implemented behavior. Check the feature-level
acceptance criteria against the actual repository state.

### 2. Full repository verification

Run the repository's actual relevant commands that exist, such as:

-   tests
-   lint
-   typecheck
-   build

Resolve feature-caused failures. Report unrelated pre-existing failures
explicitly and determine whether they prevent reliable feature
completion.

### 3. Feature-level diff review

Inspect the aggregate feature change as far as the repository/git
history permits. Check for:

-   accidental/unrelated files;
-   requirement drift;
-   inconsistent behavior across tasks;
-   duplicated domain logic introduced by separate tasks;
-   stale debug code;
-   secrets/sensitive fixtures;
-   cross-feature coupling;
-   incomplete documentation;
-   task interactions that individual task reviews could not see.

Fix unambiguous implementation defects inside the approved feature
contract and rerun affected verification. Stop for material decisions.

### 4. Documentation synchronization

Compare the implemented feature and its SPEC/TASKS state with
authoritative durable project documentation.

Update stale current-state documentation caused by this feature.
Preserve historical descriptions as historical. Do not invent new
product, architecture, security, or data-model decisions during
closeout.

### 5. Security/privacy gate

Run a focused feature-level `security-review` when any task or the
resulting feature touches a meaningful security/privacy boundary,
including:

-   authentication or authorization;
-   team/tenant isolation;
-   anonymous identity or correlation;
-   sensitive survey/wellbeing/free-text data;
-   encryption/key handling;
-   Firestore or other persistence access;
-   aggregation/privacy thresholds;
-   personal-data retention;
-   logging/error reporting of sensitive data;
-   abuse/rate limiting at a trust boundary.

For a feature with no meaningful security/privacy boundary, explicitly
record that the dedicated security review was skipped and why.

If security review returns material unresolved findings, remediate only
defects that fit the approved contract. Stop for policy/design decisions
or accepted-risk decisions.

## Safety valves

Stop the autonomous run rather than guessing when:

-   multiple tasks are unexpectedly `In Progress`;
-   task dependencies or requirement references are inconsistent;
-   the approved spec conflicts with authoritative project security
    rules;
-   a required behavior cannot be implemented without changing the spec;
-   task scope expands substantially beyond the task plan;
-   pre-existing working-tree changes make safe attribution impossible;
-   verification cannot establish confidence in feature correctness;
-   review remains `CHANGES_REQUIRED` after two remediation cycles;
-   a security review finds a material issue whose fix requires a
    policy/design decision.

Do not stop merely because an implementation choice is nontrivial. If it
is an internal engineering choice with a clearly best fit under existing
constraints, make it and continue.

## Efficiency rules

-   Do not rerun the full repository suite after every small task.
-   Use targeted tests during tasks, broader checks at meaningful
    checkpoints, and a full relevant gate at feature completion.
-   Do not repeatedly reread whole documentation files when only a known
    relevant section is needed.
-   Do not duplicate task-level review with a full security review.
-   Do not produce long narrative reports between tasks.
-   Prefer repository updates and compact handoffs over conversational
    summaries.
-   Never trade correctness/security for token savings.

## Final report

On success, report once:

``` text
FEATURE: <feature-id>
RESULT: COMPLETE

TASKS: <n>/<n> Done
REQUIREMENTS: <coverage summary>
REVIEWS: <task review summary>
SECURITY: <PASS / PASS WITH RISKS / skipped with reason>
VERIFICATION:
- <command>: <result>
- ...

DOCS: <updated paths or none>
FILES: <high-level changed areas>
PREEXISTING/UNRELATED_FAILURES: <none or concise>
REMAINING_RISKS/SUGGESTIONS: <none or concise>
```

On stop/blocker, report:

``` text
FEATURE: <feature-id>
RESULT: BLOCKED | FAILED
PROGRESS: <done>/<total>; current <task-id>
BLOCKER: <specific issue>
DECISION/ACTION NEEDED: <smallest exact user decision/action>
RECORD IN: <SPEC.md / TASKS.md / architecture/security doc / repository state>
VERIFICATION SO FAR: <concise>
SAFE RESUME: rerun implement-feature after the blocker is resolved
```

Do not begin another feature.
