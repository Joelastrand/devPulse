# DevPulse AI Workflow

This is the practical operating guide for developing DevPulse with Claude Code.

The developer follows this guide. Claude follows:
- universal instructions in `CLAUDE.md`;
- path-scoped coding rules in `.claude/rules/`;
- workflow procedures in `.claude/skills/`;
- durable project truth in `docs/`.

## Core idea

Use the repository as persistent memory and Claude Code sessions as temporary working contexts.

A fresh session should be able to continue from repository state without previous chat history. Prefer a new session when moving between workflow stages or starting a new unit of work.

Use the team's current recommended Claude Code model rather than hard-coding a permanent model name into the workflow.

Use pnpm for repository commands.

## How Claude knows how to work

DevPulse separates four concerns:

```text
CLAUDE.md
  → universal rules

.claude/rules/
  → coding rules for matching files

.claude/skills/
  → procedures for a type of work

docs/
  → durable product/system truth
```

Examples:

```text
editing TypeScript
→ typescript.md

editing React/Next/UI code
→ typescript.md + nextjs-react.md

editing application structure
→ architecture.md

editing server/Firebase/security-sensitive code
→ security.md

editing tests
→ tests.md
```

Do not copy all rule content into prompts. Invoke the correct skill and let repository context provide the relevant coding constraints.

## The five coding rules

```text
.claude/rules/
├── typescript.md
├── nextjs-react.md
├── architecture.md
├── security.md
└── tests.md
```

Rules should earn their place. Add a new rule only when it captures a durable constraint that:
- is not already reliably enforced by tooling;
- materially affects quality, architecture, or security;
- is relevant often enough to justify persistent instructions.

Prefer path-scoped rules. Avoid duplicating information between `CLAUDE.md`, rules, skills, docs, TypeScript, ESLint, and formatting tools.

`docs/SECURITY.md` remains authoritative for security/privacy policy.

## The six skills

| Situation | Skill | Result |
| --- | --- | --- |
| Define/clarify a meaningful feature | `plan-feature` | `SPEC.md` |
| Split an approved spec into work | `split-tasks` | `TASKS.md` |
| Implement one planned task | `implement-task` | One completed task |
| Independently review a change | `review-change` | Review outcome/findings |
| Investigate a concrete defect | `debug` | Root-cause fix + regression protection |
| Focused/milestone security review | `security-review` | Security/privacy findings |

## Main feature flow

```text
Feature idea
    ↓
NEW SESSION: plan-feature
    ↓
SPEC.md
    ↓
Developer reviews/approves
    ↓
END SESSION

NEW SESSION: split-tasks
    ↓
TASKS.md
    ↓
Developer reviews
    ↓
END SESSION

NEW SESSION: implement-task
    ↓
Exactly one task
    ↓
END SESSION

NEW SESSION: review-change
    ↓
PASS / PASS WITH SUGGESTIONS / CHANGES REQUIRED
    ↓
END SESSION

Repeat implement → review for the next task
```

The feature progresses through repository state, not one continuously growing conversation.

## 1. Plan the feature

Start Claude Code in the DevPulse repository.

```text
claude --model sonnet
```

```text
Use plan-feature for <describe the feature or desired outcome>.
```

Example:

```text
Use plan-feature for the first recurring developer pulse survey.
```

Claude should inspect the repository before asking questions.

Output:

```text
docs/features/<feature-id>/SPEC.md
```

Requirements use stable IDs such as `BR-1`, `BR-2`, and `BR-3`.

### Human checkpoint

Review scope, behavior, actors/access, failure behavior, security/privacy, acceptance criteria, and unresolved decisions.

If the spec needs correction, remain in the same planning session. When it is ready, end the session.

## 2. Split the feature into tasks

Start a fresh session.

```text
Use split-tasks for <feature-id>.
```

Output:

```text
docs/features/<feature-id>/TASKS.md
```

Tasks use stable IDs and trace to requirements:

```text
BR-3
  ↓
TASK-002
```

`TASKS.md` is the only owner of task state:

```text
Ready
In Progress
Done
```

Normally only one task is `In Progress`.

### Human checkpoint

Verify requirement coverage, dependencies, vertical slicing, task size, verification, and that security/testing work is included where it belongs.

When ready, end the session.

## 3. Implement exactly one task

Start a fresh session.

```text
Use implement-task for <feature-id>.
```

Normally Claude determines the task from repository state:

```text
In Progress?
  ├── yes → resume it
  └── no  → first eligible unblocked Ready task
```

A specific task may be requested when necessary:

```text
Use implement-task for TASK-003 in <feature-id>.
```

The skill implements exactly one task and applies the relevant path-scoped rules to the files it changes.

Use meaningful test-first development where useful. Run only repository scripts that actually exist, for example:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Never claim an unrun command passed.

End the session when the task is complete or concretely blocked.

## 4. Independently review the task

Start a fresh session.

```text
Use review-change to review TASK-001 for <feature-id>.
```

Fresh context is intentional. Review should use repository evidence and the actual diff rather than the implementation session's reasoning.

Possible outcomes:

```text
PASS
PASS WITH SUGGESTIONS
CHANGES REQUIRED
```

If changes are required:

```text
Clear correction inside planned task → bounded implementation correction
Concrete defect needing investigation → debug
Missing/changed requirement           → plan-feature
Task-plan problem                      → split-tasks
Broader security/privacy concern       → security-review
```

End the review session before the next unit of work.

## 5. Repeat

```text
NEW SESSION → implement TASK-001 → END
NEW SESSION → review TASK-001    → END
NEW SESSION → implement TASK-002 → END
NEW SESSION → review TASK-002    → END
...
```

Repository state is the handoff.

## Debugging flow

Start a fresh session for a concrete defect:

```text
Use debug to investigate <observable problem>.
```

Expected method:

```text
reproduce
  ↓
useful RED
  ↓
minimize
  ↓
one falsifiable hypothesis
  ↓
evidence / minimal instrumentation
  ↓
root-cause fix
  ↓
GREEN
  ↓
regression protection
```

Relevant coding rules still apply while debugging. Never add sensitive survey or identity data to logs merely to diagnose a problem.

If expected behavior is undefined, leave debugging and resolve the requirement through planning.

## Security review flow

Use `security-review` at meaningful security/privacy boundaries or milestones, not after every small task.

```text
Use security-review for <scope>.
```

Typical flow:

```text
plan
 ↓
split
 ↓
implement/review tasks
 ↓
meaningful security boundary
 ↓
NEW SESSION: security-review
 ↓
resolve material findings
```

`docs/SECURITY.md` is authoritative. `.claude/rules/security.md` guides implementation; `security-review` performs the broader adversarial assessment.

## Quick decision guide

```text
New/materially unclear feature?       → plan-feature
Approved SPEC needs tasks?            → split-tasks
Planned task should be built?         → implement-task
Implemented change needs review?      → review-change
Concrete defect/regression?           → debug
Security/privacy milestone?           → security-review
```

## When to start a fresh session

Prefer a fresh session when:
- starting a new feature;
- moving planning → task splitting;
- starting implementation after task planning;
- moving to the next implementation task;
- performing independent review;
- starting an unrelated bug investigation;
- performing a security review;
- starting another unrelated unit of work;
- the current session contains substantial irrelevant context.

Stay in the same session while completing one bounded activity.

The boundary is the unit of work, not the message count.

## When to end a session

```text
plan-feature    → SPEC ready                   → stop
split-tasks     → TASKS ready                  → stop
implement-task  → one task complete/blocked    → stop
review-change   → review outcome reported      → stop
debug           → defect fixed/blocked         → stop
security-review → findings reported            → stop
```

Do not continue into another skill merely because Claude offers to do more.

## Recovering work

```text
What are we building?
→ docs/features/<feature-id>/SPEC.md

What work exists?
→ docs/features/<feature-id>/TASKS.md

What should continue?
→ In Progress first; otherwise eligible Ready

What project rules apply?
→ CLAUDE.md + relevant .claude/rules/ + authoritative docs

What actually changed?
→ git status / diff / history
```

If a session is interrupted, start a new session and invoke the appropriate skill. Do not reconstruct task state from memory when `TASKS.md` exists.

## Lightweight changes

Small, obvious, low-risk corrections may use a lighter path when repository instructions allow it.

Do not use the lightweight path to bypass authorization, sensitive-data handling, anonymity, encryption, aggregation privacy, or meaningful product decisions.

Example: static app-shell/navigation/copy changes (e.g. the shared site
header, homepage copy, or a sign-in/sign-up cross-link) that touch no
authorization, encryption, aggregation, or persisted data are a low-risk
exception — reviewed directly via `review-change` without a retroactive
`SPEC.md`/`TASKS.md` entry.

## Workflow principles

- Repository state outlives conversation state.
- One skill has one responsibility.
- Rules define coding constraints; skills define procedures.
- One authoritative owner exists for each kind of information.
- Meaningful features move requirements → tasks → implementation.
- One implementation session handles one task.
- Self-verification and independent review are different activities.
- Debugging is evidence-driven.
- Security is built into implementation and reviewed deeply at meaningful milestones.
- Process remains proportional to the work.
- pnpm is the repository package manager.

For authoritative repository rules, see `CLAUDE.md`. For security/privacy policy, see `docs/SECURITY.md`. For coding constraints, see `.claude/rules/`. For workflow procedures, see `.claude/skills/`.
