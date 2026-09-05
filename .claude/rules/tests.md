---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "vitest.config.*"
  - "vitest.workspace.*"
---

# Tests

Use the repository's configured test runner. For DevPulse, use Vitest once configured.

Test observable behavior rather than private implementation details.

Prefer meaningful boundaries:
1. server/API behavior
2. domain/application behavior
3. component/user behavior
4. lower-level units when they contain meaningful logic

- Use descriptive test names that state the behavior.
- Keep each test focused on one behavior or contract.
- Prefer explicit assertions over broad snapshots.
- Avoid snapshot-heavy tests.
- Do not test trivial framework/library behavior.
- Do not mock the exact behavior the test is intended to prove.
- Keep fixtures small, explicit, synthetic, and obviously fictional.
- Never use real employee or wellbeing data in tests.
- Do not weaken, skip, or delete a valid failing test merely to make the suite pass.
- Add regression coverage for concrete bugs once a useful failing boundary is identified.
- For security-sensitive behavior, include negative paths where practical: unauthenticated access, unauthorized/cross-team access, invalid payloads, below-threshold aggregates, anonymous persistence without direct identity, plaintext persistence prevention, and denied raw-response access.
