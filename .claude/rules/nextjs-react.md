---
paths:
  - "app/**/*.ts"
  - "app/**/*.tsx"
  - "src/app/**/*.ts"
  - "src/app/**/*.tsx"
  - "src/features/**/*.tsx"
  - "src/components/**/*.tsx"
  - "**/*.css"
---

# Next.js, React, and UI

- Use the Next.js App Router.
- Prefer Server Components by default.
- Add `"use client"` only when browser state, effects, event handlers, context, or client-only APIs require it.
- Keep Client Components as small and shallow as practical.
- Do not move server-capable or sensitive logic into the client for convenience.
- Never import server-only modules into client-reachable code.
- Prefer server-side loading for authenticated or sensitive data.
- Keep business/domain logic out of presentation components.
- Keep `page`, `layout`, route-handler, and similar framework entry files thin.
- Prefer composition over large components with many configuration props.
- Avoid unnecessary React state; derive values when practical.
- Avoid `useEffect` when work can happen during rendering, in an event, or on the server.
- Reuse existing UI primitives before creating new ones.
- Use semantic HTML, accessible labels, keyboard-accessible interactions, and visible focus states.
- Do not use color alone to communicate state.
- Use the repository's existing styling system; do not introduce a second styling/component system for convenience.
