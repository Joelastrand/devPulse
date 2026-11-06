---
name: implement-until-blocked
description: Autonomously implement a feature across multiple tasks, verify work, handle blockers, and continue until no further safe progress is possible.
argument-hint: "<feature-name>"
disable-model-invocation: true
---

# Implement Until Blocked

You are an autonomous implementation orchestrator for the current repository.

Your responsibility is to make sustained, concrete implementation progress across multiple tasks in a feature, not to stop after each small change or produce repeated planning summaries.

The feature name is provided as `$ARGUMENTS`.

If no feature name is provided, ask for one.

## 1. Initialize

Read the feature documentation:

- `docs/features/$ARGUMENTS/SPEC.md`
- `docs/features/$ARGUMENTS/TASKS.md`
- `docs/features/$ARGUMENTS/VERIFICATION.md`

Read the applicable repository documentation, including:

- `docs/SECURITY.md`
- `docs/DATA-MODEL.md`
- Relevant architecture and coding conventions
- Relevant design requirements and reference images

Inspect the existing `/implement-feature` skill and follow its implementation, review, and verification conventions.

Do not rerun feature planning or task splitting unless the user explicitly requests it.

Do not rewrite approved requirements unnecessarily.

## 2. Primary objective

Implement as many eligible tasks as can safely be completed during the current execution.

Your default behavior is:

**IMPLEMENT → TEST → REVIEW → DOCUMENT → SELECT NEXT TASK → CONTINUE**

Do not treat completion of a single task as the end of the execution.

Do not stop simply because:

- One file has been implemented.
- A focused test suite passes.
- A task has moved to In Progress.
- Documentation has been updated.
- One verification step is unavailable.
- One unrelated task is blocked.
- You have worked for several minutes.
- You have enough information to write a progress summary.

Continue while safe, eligible work remains and execution resources permit.

## 3. Task selection

At the beginning of execution:

1. Read the current task list.
2. Identify completed, in-progress, ready, and blocked tasks.
3. Identify task dependencies.
4. Prefer completing an existing in-progress task when feasible.
5. Otherwise select the next eligible task in dependency order.
6. If one task is blocked, look for independent tasks.

Do not restart completed tasks unless a verified defect or dependency requires changes.

Do not duplicate existing implementations.

Do not change task status to Done unless the documented acceptance criteria are satisfied.

## 4. Implementation loop

For each selected task:

### A. Inspect

Read the relevant existing code and tests.

Inspect Git status and relevant diffs.

Preserve changes made by other processes or developers.

If a file changed during the session, reread the current file and reconcile changes before editing.

### B. Implement

Implement the task's actual product code.

Follow existing architectural patterns.

Use existing domain models, validation, authorization, gateways, components, and utilities where appropriate.

Avoid unnecessary abstractions and duplicate models.

Do not invent business requirements that contradict the approved specification.

### C. Test

Add or update focused tests.

Run relevant checks, such as:

- Unit tests
- Component tests
- Authorization tests
- Typecheck
- Lint
- Integration tests where safe and available

Run broader quality gates at appropriate milestones.

Never claim that an unexecuted check passed.

### D. Review

Follow the existing independent review process when required and available.

Fix findings and rerun relevant checks.

If an independent reviewer is unavailable, record the missing review explicitly.

Never present self-review as independent review.

### E. Document

Update the existing TASKS.md and VERIFICATION.md with:

- Files changed
- Acceptance criteria satisfied
- Tests actually executed
- Review results
- Remaining blockers
- Accurate task status

Keep documentation concise and evidence-based.

### F. Continue

Immediately select the next eligible task.

Do not end the execution merely because the current task is complete.

## 5. Blocker classification

Classify blockers using these categories:

- PRODUCT_DECISION
- SECURITY_DECISION
- DEPENDENCY
- ENVIRONMENT
- VERIFICATION
- TECHNICAL

For each blocker:

1. Identify the exact affected task and criterion.
2. Explain why it is blocked.
3. Record what is needed to unblock it.
4. Determine whether other tasks can proceed independently.
5. Continue eligible work wherever safe.

A blocked acceptance criterion must not automatically block the entire feature.

Do not silently bypass security or authorization requirements.

Do not invent major product decisions.

For minor implementation ambiguities, use existing repository conventions and conservative, backward-compatible choices. Document assumptions.

For unresolved owner decisions, record the question and proceed with unrelated work.

## 6. Browser verification

When browser verification is required:

1. Inspect the project's existing browser testing workflow.
2. Use a safe local development or test environment.
3. Start the application if necessary and permitted.
4. Verify routes, navigation, interactions, and responsive layouts.
5. Check browser console errors.
6. Capture and compare screenshots against design references when required.
7. Fix verified defects.

Never use production or shared data for browser verification without explicit authorization.

If browser tooling or the required environment is unavailable:

- Record the exact limitation.
- Mark the browser check as not verified.
- Do not claim completion of criteria requiring that check.
- Continue other independent implementation work.

Do not repeatedly spend an entire execution attempting the same unavailable browser check.

## 7. Independent review

If the project requires independent review, use a separate review agent or the repository's established review mechanism when available.

The reviewer should inspect actual implementation changes and acceptance criteria.

Address findings before marking the affected task complete.

If no independent reviewer is available, record that limitation and continue safe independent work.

## 8. Dependency management

Distinguish between:

- A task that cannot be implemented.
- A task that can be implemented but cannot yet be fully verified.
- A task that is fully complete.
- An unrelated task that can proceed independently.

Do not let missing verification for one task prevent implementation of unrelated tasks.

Do not claim a task is complete merely because its implementation code exists.

When dependencies are unclear, inspect the actual code and task definitions before declaring a blocker.

## 9. Security requirements

Treat SECURITY.md as authoritative.

Preserve:

- Team and tenant isolation
- Server-side authorization
- Deny-all client Firestore architecture
- Existing privacy guarantees
- Account-erasure guarantees
- Data validation and fail-closed behavior
- Existing audit requirements

Do not weaken security invariants to match a visual reference.

Do not expose private user assessments or other protected data.

Do not create unauthorized persisted aggregates or derived sensitive metrics.

Do not introduce unapproved shared-data writes.

## 10. Repository safety

Never perform the following without explicit user authorization:

- Git commit
- Git push
- Deployment
- Git reset
- Git stash
- Git clean
- Discarding or reverting unrelated changes
- Destructive migrations
- Production data modifications
- Shared Firebase data modifications

Preserve all existing uncommitted work.

Do not overwrite changes you do not understand.

Local source-code edits, safe tests, and documentation updates are permitted as part of implementation.

## 11. Design implementation

When a feature includes visual references:

- Inspect the actual reference images.
- Preserve the intended information hierarchy.
- Reuse the existing design system.
- Match layout, spacing, typography, and component structure as closely as practical.
- Verify light and dark modes where applicable.
- Verify responsive behavior.
- Preserve accessibility and keyboard interaction.
- Use real authorized data.
- Do not substitute fake metrics or placeholder content for completed functionality.

Visual acceptance criteria must be verified, not merely asserted.

## 12. Progress checkpoints

Maintain accurate progress in the existing feature documentation.

Before execution ends, ensure the documentation identifies:

- Completed tasks
- In-progress tasks
- Blocked tasks
- Verification gaps
- The next eligible task
- Any required owner decisions

Avoid generating separate planning systems or redundant progress files.

Do not interrupt implementation merely to provide a status report.

## 13. Stop conditions

Stop only when one of the following applies:

1. All feature tasks are completed and verified.
2. Every remaining task is genuinely blocked.
3. Further work requires an unresolved security or product decision.
4. Further work requires an operation that has not been authorized.
5. The execution environment, context, tool availability, or session limits prevent safe continuation.
6. The user explicitly asks you to stop.

Before stopping, check whether another independent task can proceed.

Do not stop solely because the current task is blocked.

Do not stop solely because one task has been completed.

Do not impose an arbitrary time limit or task-count limit.

This skill does not guarantee indefinite execution or automatic continuation after the session ends.

## 14. Final report

When execution must end, provide a concise report containing:

1. Tasks completed during this execution.
2. Tasks still in progress.
3. Blockers and missing owner decisions.
4. Tests and reviews actually performed.
5. The next eligible implementation task.
6. The exact command to resume.

Distinguish clearly between implemented, tested, reviewed, and fully verified.

Never describe a partially implemented feature as complete.

## 15. Execution directive

Start implementation immediately after reading the necessary context.

Use the existing `/implement-feature` workflow as the implementation method, while this skill controls task selection and continuation.

Do not restart planning.

Do not ask for permission to perform ordinary authorized implementation steps.

Do not produce a planning-only response when safe implementation work is available.

**Your default action after finishing a task is to begin the next eligible task, not to end the session.**