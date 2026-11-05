---
name: implement-feature
description: >
  Autonomously implement one approved, task-split DevPulse feature from
  docs/features/<feature-id>/SPEC.md and TASKS.md. Orchestrate one task at a
  time through implementation, independent review, automatic remediation,
  durable checkpoints, feature-level verification, and security review where
  applicable. Continue after passing subordinate skills; stop only for a
  genuine blocker, an exhausted bounded retry, or an execution limit.
---

# implement-feature

Implement **one approved, task-split feature** end-to-end with minimal user interaction. This is the **parent orchestration workflow**. The repository, not the conversation, is the durable source of truth.

## 1. Non-negotiable orchestration contract

**A subordinate skill returning is not the end of this feature run.** `implement-task-for-feature`, `review-task-for-feature`, and `security-review` produce intermediate results for this parent workflow. After each subordinate result, **resume this orchestration loop in the same turn whenever execution remains available**.

Do not issue a terminal feature-level report while an eligible task remains, unless an explicit stop condition applies. Do not ask the user whether to continue after an ordinary implementation, a passing review, or a remediable defect. Do not invoke another feature.

The parent must interpret results as follows:

| Result | Parent action |
|---|---|
| `IMPLEMENTED` | Independently review the same task. |
| `PASS` | Finalize task checkpoint; select the next eligible task. |
| `PASS_WITH_SUGGESTIONS` | Record material nonblocking suggestions if useful; finalize task checkpoint; select the next eligible task. |
| `CHANGES_REQUIRED` | Remediate Blocking/Important findings in the same task; rerun affected checks and independent review, within retry limits. |
| `REVIEW_BLOCKED` | Attempt once to recover missing review evidence; if unresolved, stop with a precise blocker. |
| `BLOCKED` | Stop only when the stated blocker meets the human-decision or safety rules below; otherwise resolve it within the approved contract and continue. |
| `FAILED` | Make at most one focused technical retry if the cause is clear and within scope; otherwise stop. |

A reviewer's `NEXT: continue` means **the parent continues**, not that the assistant should stop and ask the user to run the next command. The review skill may be prohibited from editing code; **the parent is still responsible for invoking implementation/remediation after that review**.

A task is **not accepted** until its independent review returns `PASS` or `PASS_WITH_SUGGESTIONS`. An implementation skill marking a task `Done` early is provisional and must be corrected if review fails. Do not select the next task while the current task has unresolved Blocking/Important findings.

If the tool or skill runner genuinely ends control after a subordinate invocation, do not pretend the loop continued. Persist an accurate checkpoint and provide the smallest possible resume instruction. This skill cannot override platform execution limits.

## 2. Scope, prerequisites, and sources of truth

Identify exactly one `<feature-id>`. Read:

- `docs/features/<feature-id>/SPEC.md` (approved feature contract)
- `docs/features/<feature-id>/TASKS.md` (task dependencies and progress)
- Repository instructions (`CLAUDE.md` and any relevant local instructions)
- Relevant sections of `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/DATA-MODEL.md`
- Relevant implementation/review skill instructions when invoking them

Before modifying product code, verify:

1. The spec is approved and implementation-ready.
2. In-scope behavioral requirements have stable `BR-*` identifiers.
3. No material open decision blocks the work.
4. `TASKS.md` exists and maps the requirements to implementable tasks.
5. At most one task is `In Progress`.
6. Task dependencies are coherent; completed tasks have review evidence or can be safely reconciled from repository evidence.
7. The working-tree baseline is attributable enough to review the feature safely.

Do not silently regenerate the spec or task list, change approved scope, or rewrite historical decisions. If an already-approved feature is being resumed, **resume it**; do not restart planning.

### Existing working-tree changes

Inspect `git status` and relevant diffs. Preserve pre-existing user changes. Do not reset, stash, clean, overwrite, commit, push, or deploy without explicit authorization. A dirty working tree is **not automatically a blocker**: proceed if task changes can be safely attributed through a recorded baseline, file-level diffs, or other reliable evidence. Stop if attribution is genuinely ambiguous and destructive handling would be required.

## 3. Autonomy and decision boundaries

Proceed autonomously on ordinary implementation decisions: component structure, naming, layout within the approved visual specification, existing patterns, local refactors, tests, accessibility implementation, and error handling already implied by project rules.

**Stop for a human decision only when necessary to:**

- Change approved product behavior or material scope.
- Choose between materially different user-visible behaviors not resolved by the spec.
- Change an architecture contract or security/privacy policy.
- Change authentication, authorization, anonymity, encryption, retention, or a trust boundary.
- Accept a known material security/privacy risk.
- Resolve a genuine conflict between approved authoritative requirements that cannot be satisfied together.
- Handle ambiguous pre-existing changes destructively.
- Expand work so substantially that `TASKS.md` is no longer a reliable plan.
- Resolve a blocker that cannot be fixed inside the approved contract.

Do **not** stop merely because a task is difficult, a presentation test asserts an obsolete layout, a reviewer proposes a nonblocking improvement, or authenticated browser automation is unavailable when safe implementation can proceed.

For an actual blocker, ask for the **smallest exact decision**, explain the conflicting requirements, recommend a safe option if appropriate, and identify where the decision should be recorded. Do not assume the user approved a policy change by requesting autonomous work.

## 4. State model and checkpoint discipline

Use `SPEC.md` and `TASKS.md` as the authoritative durable state. At the beginning of each task cycle, reload the current task, dependencies, and relevant requirements. Do not rely solely on conversation memory.

Use the existing task status schema; do not invent conflicting statuses. If the task system marks `Done` immediately after implementation, treat it as **provisional until independent review passes**. On `CHANGES_REQUIRED`, reopen the same task or explicitly record `review pending/changes required` according to the task file's established conventions. Never report a failed review as accepted completion.

After each passing review:

1. Verify the task is `Done` and the status counts are correct.
2. Record review result and any material outstanding nonblocking suggestion.
3. Record relevant files, tests, and decisions in the task's existing durable fields.
4. Keep only notes needed by a fresh session; avoid verbose transcripts.
5. Reload `TASKS.md` and immediately select the next eligible task.

For an interrupted run, leave a compact durable checkpoint (in `TASKS.md` or an existing feature checkpoint file) containing:

- Feature and task ID; current status.
- Last passing review and remediation attempt count.
- Exact next action.
- Relevant changed files and verification results.
- Any real blocker and its decision owner.

Do not mark work verified when it was not verified. Do not create a second competing progress system unless the approved feature already requires one.

## 5. Main autonomous loop

**Repeat while execution is available and eligible work remains.**

### Step A — Select one task

1. Resume the single `In Progress` task, including an unfinished review/remediation.
2. Otherwise choose the first unblocked `Ready` task whose dependencies are `Done` and accepted.
3. Never have more than one task `In Progress`.
4. If no eligible task exists, determine whether all tasks are accepted or a genuine dependency/blocker remains. Do not claim success merely because no task is currently selectable.

### Step B — Implement

Invoke the complete `implement-task-for-feature` workflow for the selected task. The child implements **one task only**. Inspect its result and repository evidence.

- `IMPLEMENTED`: go directly to Step C.
- `FAILED`: retry once only if a focused, safe fix is clear; otherwise stop.
- `BLOCKED`: evaluate against Section 3; resolve ordinary technical issues without a user decision where possible.

Use the reference images and visual acceptance criteria when the approved task concerns UI redesign. Passing tests alone never establishes visual fidelity. Implement real responsive components, not screenshot replicas or superficial token changes.

### Step C — Independently review

Invoke `review-task-for-feature` against the **actual task diff, relevant tests, and acceptance criteria**. Keep implementation and review logically independent; the review skill reports findings and does not silently fix them.

- `PASS`: go to Step E.
- `PASS_WITH_SUGGESTIONS`: record only material suggestions, then Step E. Suggestions are **not blockers**.
- `CHANGES_REQUIRED`: go to Step D.
- `REVIEW_BLOCKED`: attempt once to recover missing evidence; stop if unresolved.

The parent **must not terminate** simply because the review skill has finished or printed its own final report.

### Step D — Remediate the same task

For `CHANGES_REQUIRED`:

1. Keep or reopen the **same** task; do not start another.
2. Extract the review's Blocking and Important findings.
3. If a finding needs a genuine product/security/architecture decision, stop and ask precisely for it.
4. Otherwise invoke implementation/remediation to fix those findings within the approved contract.
5. Add or update regression tests where appropriate.
6. Run affected checks, inspect the remediation diff, and independently review again.

Allow at most **two review-remediation cycles per task**. After the second unsuccessful cycle, stop with the unresolved findings; do not enter an unbounded loop. A new, user-resolved specification decision may authorize a fresh attempt, but do not silently reset the counter.

A `PASS_WITH_SUGGESTIONS` result after remediation is accepted and proceeds to Step E. Do not spend another cycle fixing suggestions unless they expose an actual requirement violation.

### Step E — Checkpoint and immediately continue

Finalize the passing task as described in Section 4. Then **return to Step A without asking for user approval or writing a terminal report**.

After every three accepted tasks, or after a task with broad architectural/security impact, run a lightweight milestone gate:

- Check task counts, dependencies, and BR coverage.
- Run broader checks only where accumulated changes justify them.
- Confirm no unresolved Blocking/Important task-review finding.
- Continue immediately; this is a checkpoint, not a new approval ceremony.

## 6. UI redesign and visual verification rules

When a feature has approved visual references:

- Inspect the actual references where image inspection is available; do not infer fidelity from filenames.
- Treat layout, hierarchy, spacing, typography, card composition, and responsive behavior as implementation requirements.
- Preserve actual data, authorization, privacy thresholds, and domain behavior; replace unsupported reference elements with truthful, polished alternatives.
- Update presentation-only tests when an approved design intentionally changes presentation, while retaining behavioral, privacy, and accessibility assertions.
- Do not let old DOM snapshots prevent legitimate redesign; preserve meaningful reading order and keyboard behavior.
- Distinguish `implemented in code`, `tested`, and `visually verified`.
- If authenticated browser access is unavailable, continue safe frontend implementation and record manual browser verification as pending. Never claim rendered visual fidelity without evidence.
- Do not create authentication bypasses, weaken Firebase security, or seed an unverified project just to obtain screenshots.

If the approved feature requires a separate visual-verification document, maintain it accurately. Missing browser evidence must not be silently converted into a pass; if a specific task explicitly requires that evidence as a hard acceptance gate, record a genuine verification blocker instead of fabricating evidence.

## 7. Feature completion gate

Only after **every in-scope task has an accepted independent review**:

### 7.1 Requirement and acceptance coverage

Verify each in-scope `BR-*` is covered by accepted tasks and implemented behavior. Check feature-level acceptance criteria against actual repository evidence. Identify any acceptance criterion that still needs manual browser evidence.

### 7.2 Full repository verification

Run the actual relevant commands available in the repository, typically:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Resolve feature-caused failures. Distinguish unrelated pre-existing failures and skipped checks. Never report an unrun check as passing.

### 7.3 Aggregate diff review

Inspect the feature-wide change set for accidental files, requirement drift, duplicated logic, stale debug code, secrets, inconsistent interactions, cross-feature coupling, accessibility regressions, and documentation gaps. Fix unambiguous defects inside scope and rerun affected checks. Do not overwrite unrelated user changes.

### 7.4 Documentation synchronization

Update current-state docs affected by implementation. Preserve historical decisions as history. Do not introduce new product/security/data-model decisions during closeout. Ensure `SPEC.md`, `TASKS.md`, and any required verification file agree.

### 7.5 Security/privacy gate

Invoke focused `security-review` when the feature affects authentication, authorization, team isolation, anonymous identity/correlation, sensitive surveys/free text, encryption, persistence, privacy thresholds, personal-data retention, sensitive logging, or abuse controls. Otherwise record why a dedicated security review is unnecessary.

Remediate unambiguous in-scope findings. Stop for policy/design or accepted-risk decisions. Do not weaken the project's security rules to satisfy a visual reference.

### 7.6 Honest completion classification

Report `COMPLETE` only when all implementation/review gates and required verification gates have passed. If all code tasks are accepted but manual visual checks remain, report **implementation complete; visual verification pending** rather than claiming the visual design is verified. If the approved spec makes manual visual verification a hard completion condition, do not label the feature fully complete until it occurs.

## 8. Safety valves and execution limits

Stop safely for:

- Multiple simultaneous `In Progress` tasks or inconsistent dependencies that cannot be reconciled from evidence.
- An approved-spec conflict with authoritative security rules.
- A required material product/architecture/security decision.
- Unsafe or unattributable destructive handling of user changes.
- A task plan that no longer covers the required work.
- Missing evidence that prevents a required review after one recovery attempt.
- Two unsuccessful remediation cycles for the same task.
- A material unresolved security finding.
- An actual tool, context, or execution limit.

For an execution limit, save the best possible checkpoint and give a precise resume command. Do not imply that the assistant will continue working in the background after the turn ends. Do not convert an ordinary passing review or suggestion into a blocker.

## 9. Efficiency

- Use targeted tests during tasks; broader tests at milestones; full checks at completion.
- Read relevant sections rather than repeatedly loading whole documents.
- Keep intermediate commentary minimal and do not generate a final user-facing report after each child skill.
- Prefer durable task updates to lengthy handoffs.
- Maintain independent review; do not substitute self-asserted success for the reviewer gate.
- Do not trade security, correctness, or visual acceptance for speed.
- Do not commit, push, deploy, run migrations, or touch production data without authorization.

## 10. Final report

Report **once**, when complete or genuinely stopped. Do not use this template after an ordinary passing subordinate review.

### On complete implementation

```text
FEATURE: <feature-id>
RESULT: COMPLETE | IMPLEMENTATION_COMPLETE_VISUAL_VERIFICATION_PENDING
TASKS: <accepted>/<total> accepted
REQUIREMENTS: <coverage summary>
REVIEWS: <PASS / PASS_WITH_SUGGESTIONS summary>
SECURITY: <PASS / PASS_WITH_RISKS / skipped with reason>
VERIFICATION:
- <command>: <actual result>
DOCS: <updated paths>
FILES: <high-level changed areas>
VISUAL_VERIFICATION: <evidence or precise pending routes>
PREEXISTING_FAILURES: <none or concise>
REMAINING_RISKS: <none or concise>
```

### On genuine blocker or execution limit

```text
FEATURE: <feature-id>
RESULT: BLOCKED | FAILED | INTERRUPTED
PROGRESS: <accepted>/<total>; current <task-id>
LAST_REVIEW: <result and remediation count>
BLOCKER: <specific factual issue or execution limit>
DECISION/ACTION_NEEDED: <smallest exact action, if any>
RECORD_IN: <durable file>
VERIFICATION_SO_FAR: <concise>
NEXT_ACTION: <exact next task/step>
SAFE_RESUME: /implement-feature <feature-id>
```

**Never stop merely because `review-task-for-feature` returned `PASS`, `PASS_WITH_SUGGESTIONS`, or a remediable `CHANGES_REQUIRED`. Return control to this parent workflow and continue.**
