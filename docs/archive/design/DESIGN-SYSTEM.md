# DevPulse — Design System

**Version:** 1.0  
**Status:** Proposed design specification  
**Product:** DevPulse  
**Visual direction:** Modern, warm, premium SaaS  
**Brand identity:** Deep forest green  
**Design philosophy:** Clarity · Progress · Reflection  
**Interface language:** Norwegian (Bokmål)

---

## 1. Purpose

This document defines the shared visual and interaction system for DevPulse.

It translates the design direction described in `DESIGN-README.md` and the generated reference images into implementation-ready rules.

The design system must make DevPulse feel like one coherent product rather than a collection of independently designed pages.

### Primary objectives

1. Create a recognizable visual identity.
2. Establish consistent layouts, spacing, typography, and colors.
3. Improve readability and information hierarchy.
4. Make navigation and interactions predictable.
5. Support desktop, tablet, and mobile.
6. Maintain accessible light and dark themes.
7. Reduce duplicated styling and inconsistent components.
8. Preserve existing security, privacy, and domain behavior.

### Design principles

**Clarity** — Users immediately understand what they are seeing.

**Progress** — Users can identify meaningful next steps without artificial productivity pressure.

**Reflection** — The interface supports thoughtful individual and team development.

**Trust** — Data is represented accurately, privacy boundaries remain visible, and the product does not make unsupported claims.

**Restraint** — Every color, border, icon, illustration, and animation serves a purpose.

---

## 2. Source of truth

This document specifies the intended visual and interaction system.

Implementation must respect the following priority order:

1. Security, privacy, consent, and authorization requirements
2. Approved feature specifications and domain invariants
3. Existing API contracts and supported application behavior
4. `DESIGN-README.md` and this design system
5. Generated design reference images

The reference images are visual guidance, not permission to create new product features.

Before changing existing design tokens, inspect the current implementation. Reuse or migrate compatible tokens rather than creating competing systems.

Do not introduce a second component library or styling framework merely to reproduce the references.

---

## 3. Brand foundations

### 3.1 Brand character

DevPulse should feel:

- Calm
- Professional
- Human
- Warm
- Modern
- Trustworthy
- Focused
- Thoughtful

DevPulse should not feel:

- Corporate and bureaucratic
- Overly playful
- Competitive
- Surveillance-oriented
- Visually noisy
- Like a generic admin template

### 3.2 Visual signature

The visual identity combines:

- Deep forest-green navigation
- Warm off-white page backgrounds
- Clean white content surfaces
- Restrained emerald accents
- Dark charcoal typography
- Soft borders
- Controlled corner radii
- Subtle elevation
- Consistent Lucide outline icons
- Sparse landscape-inspired illustrations

The design must remain functional without illustrations.

---

## 4. Color system

### 4.1 Principles

Use semantic color tokens throughout the application.

Avoid hard-coded hex values in page components.

Never rely on color alone to communicate meaning.

All text/background combinations must be checked for appropriate contrast in their actual rendered states.

### 4.2 Brand palette

The following colors are proposed starting values.

| Token | Hex | Intended use |
|---|---|---|
| `brand-950` | `#053F35` | Deep sidebar background |
| `brand-900` | `#075446` | Navigation and brand surfaces |
| `brand-800` | `#086A55` | Strong brand surfaces |
| `brand-700` | `#087B5B` | Primary actions |
| `brand-600` | `#11916E` | Accent, subject to contrast validation |
| `brand-200` | `#B8E4D0` | Soft highlights |
| `brand-100` | `#DDF3E7` | Selected backgrounds |
| `brand-50` | `#EFF9F3` | Subtle brand backgrounds |

Do not automatically use `brand-600` for small text on white. Validate contrast first.

### 4.3 Neutral palette

| Token | Hex | Intended use |
|---|---|---|
| `neutral-950` | `#14242B` | Primary text |
| `neutral-800` | `#34454D` | Strong secondary text |
| `neutral-600` | `#50616B` | Secondary text |
| `neutral-500` | `#68777D` | Muted text |
| `neutral-300` | `#CBD4D1` | Strong dividers |
| `neutral-200` | `#E5E9E6` | Subtle borders |
| `neutral-100` | `#F1F3F0` | Muted surfaces |
| `neutral-50` | `#FAF9F6` | Warm application canvas |
| `white` | `#FFFFFF` | Main surfaces |

### 4.4 Semantic tokens

Components should consume semantic tokens rather than palette values directly.

| Semantic token | Light theme |
|---|---|
| `--background` | `#FAF9F6` |
| `--foreground` | `#14242B` |
| `--surface` | `#FFFFFF` |
| `--surface-muted` | `#F1F3F0` |
| `--surface-hover` | `#F5F7F4` |
| `--border` | `#E5E9E6` |
| `--border-strong` | `#CBD4D1` |
| `--text-primary` | `#14242B` |
| `--text-secondary` | `#50616B` |
| `--text-muted` | `#68777D` |
| `--primary` | `#087B5B` |
| `--primary-hover` | `#086A55` |
| `--primary-foreground` | `#FFFFFF` |
| `--focus-ring` | `#087B5B` |
| `--sidebar-background` | `#053F35` |
| `--sidebar-foreground` | `#F2F8F4` |
| `--sidebar-muted` | `#B8D2C8` |
| `--sidebar-active` | `#176B58` |

These values are design candidates, not verified accessibility results.

### 4.5 Status colors

Status colors must have semantic meaning.

| Status | Usage |
|---|---|
| Success | Completed, saved, confirmed |
| Warning | Attention needed, pending |
| Error | Failed operation, destructive state |
| Information | Neutral guidance |
| Inactive | Archived, disabled, unavailable |

Each status requires:

- Background token
- Foreground token
- Border token where needed
- Accessible icon or text label

Do not use red or amber merely to create visual variety.

### 4.6 Chart colors

Charts should use a restrained, accessible palette.

Suggested series:

- Primary green
- Muted teal
- Slate blue
- Soft amber
- Neutral gray

Use consistent series colors across related charts.

Provide labels, legends, patterns, or other non-color distinctions where appropriate.

Missing or privacy-suppressed data must never be represented as zero.

---

## 5. Theme system

### 5.1 Supported modes

DevPulse must support:

- Light
- Dark
- Follow system

The light theme is the default visual direction.

The dark theme must be fully usable and visually coherent.

### 5.2 Light theme

Characteristics:

- Warm off-white page background
- White cards
- Deep green sidebar
- Dark text
- Restrained shadows
- Soft borders

### 5.3 Dark theme

Characteristics:

- Deep neutral application canvas
- Slightly lighter card surfaces
- Distinct but subtle borders
- Readable light typography
- Adjusted green accents
- Reduced shadow dependence

Suggested dark starting values:

| Token | Value |
|---|---|
| `--background` | `#111A1B` |
| `--foreground` | `#EDF3F0` |
| `--surface` | `#1B2829` |
| `--surface-muted` | `#233234` |
| `--border` | `#344547` |
| `--text-secondary` | `#B5C5C1` |
| `--primary` | `#5DC9A1` |
| `--primary-foreground` | `#082E25` |

These values require rendered contrast verification.

### 5.4 Theme behavior

- Respect the selected theme across routes.
- Follow system preference when that mode is selected.
- Avoid a visible flash of the wrong theme during initial load.
- Use semantic tokens in every component.
- Do not hard-code light backgrounds inside dark-mode components.
- Verify charts, dialogs, tooltips, forms, and illustrations in both themes.

---

## 6. Typography

### 6.1 Font

Use a modern sans-serif typeface with strong readability and Norwegian character support.

Prefer the existing project font if suitable.

If a replacement is approved, apply it consistently across the application.

Recommended characteristics:

- Clear lowercase forms
- Good readability at 14–16px
- Distinct numeric characters
- Balanced weights
- Professional but approachable appearance

### 6.2 Type scale

| Role | Desktop size | Mobile size | Weight |
|---|---|---|---|
| Display | 40px | 32px | 700 |
| Page title | 30px | 26px | 700 |
| Section title | 22px | 20px | 650–700 |
| Card title | 17px | 17px | 600 |
| Body large | 16px | 16px | 400 |
| Body | 14–15px | 15px | 400 |
| Supporting text | 13px | 13–14px | 400 |
| Label | 13–14px | 14px | 600 |
| Caption | 12px | 12–13px | 400 |

Use a limited set of actual font weights supported by the selected font.

Avoid excessive use of small text.

### 6.3 Line height

Suggested values:

- Headings: 1.15–1.3
- Body: 1.5–1.65
- Labels: 1.3–1.4

### 6.4 Content rules

- Prefer short, meaningful headings.
- Use sentence case.
- Avoid unnecessary uppercase labels.
- Keep paragraphs concise.
- Make numeric values easy to scan.
- Use tabular numerals in data-heavy components.
- Do not truncate essential privacy information.

### 6.5 Norwegian interface copy

All user-facing product copy should use Norwegian Bokmål.

Examples:

- `Hjem`
- `Team`
- `Ferdigheter`
- `Mål`
- `Samtaler`
- `Min profil`
- `Administrasjon`
- `Lagre`
- `Avbryt`
- `Neste`
- `Tilbake`

Avoid mixing English and Norwegian in the same interface.

---

## 7. Spacing system

Use a consistent 4px-based spacing scale.

| Token | Value |
|---|---|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 20px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-12` | 48px |
| `space-16` | 64px |

### Recommended application

- Icon-to-label gap: 8–12px
- Input label-to-field gap: 6–8px
- Card internal padding: 20–24px
- Section gap: 32–40px
- Desktop page padding: 32–40px
- Tablet page padding: 24px
- Mobile page padding: 16px
- Button horizontal padding: 16–20px

### Spacing philosophy

Whitespace must communicate hierarchy.

Avoid both extremes:

- Dense layouts with insufficient separation
- Oversized empty areas with little useful information

Use fewer, more intentional containers rather than compensating for weak hierarchy with excessive padding.

---

## 8. Radius and elevation

### 8.1 Border radius

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 6px | Small controls |
| `radius-md` | 10px | Inputs, buttons |
| `radius-lg` | 14px | Cards |
| `radius-xl` | 18px | Large panels |
| `radius-2xl` | 24px | Hero and special surfaces |
| `radius-full` | 9999px | Pills and circular elements |

Avoid excessively rounded cards everywhere.

### 8.2 Shadows

Use subtle elevation.

Suggested levels:

**Level 0:** No shadow — default for most surfaces.

**Level 1:** Soft shadow — raised cards and hover states.

**Level 2:** Moderate shadow — dropdowns, popovers, floating menus.

**Level 3:** Stronger shadow — dialogs and overlays.

Prefer borders and surface contrast over heavy shadows.

Dark mode should rely more on surface separation than shadow.

---

## 9. Application shell

### 9.1 Desktop sidebar

Suggested width: 248–264px.

Characteristics:

- Deep forest-green background
- Product logo at top
- Grouped navigation
- Consistent icons
- Clear active item
- User/account section near bottom
- Comfortable vertical spacing

### 9.2 Sidebar navigation items

Suggested dimensions:

- Height: 40–44px
- Horizontal padding: 12–16px
- Icon size: 18–20px
- Gap: 10–12px
- Radius: 10px

Active state:

- Distinct background
- Strong foreground contrast
- Clear accessible indication of current page

Do not rely solely on color to indicate the active route.

### 9.3 Navigation groups

**Workspace**
- Hjem
- Team

**Min utvikling**
- Ferdigheter
- Mål
- Samtaler

**Administrasjon**
- Team
- Roller

**Account**
- Min profil
- Logg ut

Only display routes the user is authorized to access.

Do not introduce a new overview route for personal development unless separately approved.

### 9.4 Mobile shell

On mobile:

- Replace persistent sidebar with a drawer.
- Provide a clear menu button.
- Preserve navigation grouping.
- Manage focus appropriately.
- Close on Escape.
- Close after navigation.
- Prevent unintended background scrolling.
- Keep touch targets usable.

### 9.5 Main content area

Suggested:

- Full available width
- Consistent responsive padding
- Optional maximum width based on page type
- No universal narrow column

Page types may use different content widths:

- Analytics: wide
- Team overview: wide
- Roadmap: wide
- Conversations: wide split layout
- Forms: focused
- Survey: narrow

---

## 10. Page composition

Every primary page should use a recognizable structure.

### 10.1 Page header

Include as appropriate:

- Page title
- Short supporting description
- Breadcrumb or back navigation
- Primary action
- Secondary actions

The primary action should be visually dominant without overwhelming the heading.

### 10.2 Section structure

Each major section should have:

- Clear heading
- Optional concise description
- Relevant action when needed
- Content directly below

Avoid adding a card around every section.

### 10.3 Information hierarchy

Preferred order:

1. Context
2. Current state
3. Meaningful insights
4. Available actions
5. Supporting details

### 10.4 Dashboard density

Use a balanced combination of:

- Summary information
- Charts
- Lists
- Timelines
- Action panels

Do not fill the screen with generic KPI cards.

Only show metrics supported by actual data.

---

## 11. Component specifications

### 11.1 Buttons

Variants:

- Primary
- Secondary
- Outline
- Ghost
- Destructive

Sizes:

| Size | Height |
|---|---|
| Small | 32px |
| Medium | 40px |
| Large | 44–48px |

Rules:

- Use one clear primary action per main context.
- Keep labels action-oriented.
- Show loading state when appropriate.
- Disable repeated submissions when needed.
- Maintain visible keyboard focus.
- Do not use destructive styling for ordinary secondary actions.

### 11.2 Cards

Cards should have:

- Clear purpose
- Consistent padding
- Restrained borders
- Optional title and action
- Appropriate responsive behavior

Default recommendation:

- White surface
- 1px subtle border
- 14px radius
- 20–24px padding
- No shadow or very subtle shadow

Avoid nested bordered cards unless the hierarchy genuinely requires them.

### 11.3 Inputs

Inputs should have:

- Persistent visible label
- Appropriate helper text
- Clear error state
- Consistent height
- Comfortable padding
- Visible focus state
- Correct input type

Suggested height: 40–44px.

Placeholders must not replace labels.

### 11.4 Selects and dropdowns

- Use accessible controls.
- Preserve keyboard navigation.
- Clearly indicate selected values.
- Avoid unnecessary custom implementations.
- Keep menus within viewport boundaries.

### 11.5 Tabs

Use tabs for closely related views within one context.

Rules:

- Clear selected state
- Keyboard support
- Appropriate ARIA semantics
- Consistent spacing
- No unnecessary tab nesting

### 11.6 Badges

Use badges for concise, meaningful status.

Examples:

- `Aktiv`
- `Planlagt`
- `Fullført`
- `Arkivert`

Avoid using badges merely as decoration.

### 11.7 Dialogs

Dialogs should:

- Have a clear title
- Explain the action
- Use appropriate focus management
- Support Escape where safe
- Restore focus when closed
- Provide explicit confirmation for destructive actions

Do not use confirmation dialogs for every harmless interaction.

### 11.8 Empty states

A useful empty state includes:

1. Clear explanation
2. Contextual guidance
3. Relevant action, if available

Example:

**Ingen mål ennå**

`Opprett et mål for å samle det du ønsker å utvikle videre.`

Action: `Opprett mål`

Do not invent actions that the user cannot perform.

### 11.9 Loading states

Use skeletons when they preserve layout and improve perceived stability.

Use spinners for short, localized operations.

Avoid full-page loading indicators when only one section is updating.

### 11.10 Error states

Error messages should:

- Explain what failed
- Avoid exposing technical internals
- Provide a useful retry action where possible
- Preserve user input when safe

### 11.11 Tables

Use tables for structured comparisons and administrative data.

Requirements:

- Readable headers
- Clear row spacing
- Accessible labels
- Responsive behavior
- Appropriate empty state
- No unnecessary columns

For narrow screens, use deliberate responsive patterns rather than silently hiding essential information.

---

## 12. Data visualization system

### 12.1 Principles

Charts must communicate actual information.

Do not use charts as decoration.

### 12.2 Chart containers

Use a consistent chart presentation pattern:

- Title
- Optional description
- Relevant controls
- Visualization
- Legend
- Supporting explanation
- Data fallback where required

A shared chart container is useful, but must not compromise error boundaries or accessible fallback content.

### 12.3 Survey charts

Requirements:

- Aggregated data only
- Privacy thresholds preserved
- Clear time labels
- No fabricated results
- Missing data shown as unavailable, not zero
- Mobile scrolling where appropriate
- Accessible alternative representation

### 12.4 Competency visualization

Suitable patterns:

- Grouped competency lists
- Level indicators
- Coverage summaries
- Role expectation comparisons

Do not create employee rankings or performance scores.

### 12.5 Roadmap visualization

Choose the visual form according to supported data.

Possible patterns:

- Timeline
- Milestone rail
- Now / Next / Later
- Status-grouped plan
- Gantt-style view, only when supported by dates and dependencies

Do not infer progress percentages from status labels.

---

## 13. Icons

Use Lucide as the primary icon family.

### Rules

- Named imports only
- Consistent outline style
- Consistent visual weight
- Avoid decorative overuse
- Pair icons with text for important actions
- Do not use icons as the sole status indicator without an accessible name

### Suggested sizes

| Context | Size |
|---|---|
| Inline | 16px |
| Navigation | 18–20px |
| Buttons | 16–18px |
| Card heading | 20px |
| Empty state | 24–32px |

Do not import the entire icon library into the client bundle.

---

## 14. Illustrations

### Visual direction

Original, minimal landscape-inspired SVG illustrations.

Suggested motifs:

- Rolling hills
- Horizon lines
- Soft sunrise
- Organic curves
- Calm natural shapes

### Usage

Use illustrations sparingly.

Preferred placements:

- Selected empty states
- Survey completion
- Public landing
- Important onboarding moments

### Restrictions

- No third-party copyrighted artwork without appropriate rights
- No screenshot crops as production illustrations
- No excessive animation
- No illustration that obscures essential information

Illustrations must work in both light and dark themes.

---

## 15. Motion

### Motion principles

Motion should communicate state and continuity.

Recommended durations:

| Interaction | Duration |
|---|---|
| Hover transition | 100–150ms |
| Button feedback | 100–150ms |
| Disclosure | 150–200ms |
| Drawer transition | 150–200ms |
| Dialog transition | 150–200ms |

Use restrained easing.

Avoid:

- Bouncing cards
- Large entrance animations
- Constant pulsing
- Attention-seeking transitions
- Decorative parallax

### Reduced motion

Respect `prefers-reduced-motion`.

Ensure the interface remains fully usable when animations are disabled or minimized.

---

## 16. Responsive system

### Breakpoints

Suggested starting points:

| Range | Intended layout |
|---|---|
| Below 640px | Mobile |
| 640–1023px | Tablet |
| 1024px and above | Desktop |

These are implementation guidelines, not rigid device categories.

Adapt layouts according to actual content needs.

### Mobile rules

- Single-column layouts where appropriate
- Accessible drawer navigation
- Full-width primary actions when useful
- Comfortable touch targets
- No unintended horizontal page scrolling
- No clipped text
- No hidden essential controls

### Chart behavior

Charts may use internal horizontal scrolling on narrow screens if necessary.

The page itself should not overflow horizontally.

Provide accessible alternatives.

### Required verification

Check at:

- 320px
- 360px
- 768px
- 1280px
- 200% zoom

---

## 17. Accessibility requirements

### General

Use semantic HTML and accessible interaction patterns.

### Keyboard

All interactive controls must be operable without a mouse.

Ensure:

- Logical tab order
- Visible focus
- Escape behavior
- Appropriate focus management
- No keyboard traps

### Forms

- Visible labels
- Clear instructions
- Error associations
- Appropriate required-field indicators
- Accessible validation feedback

### Color and contrast

Target WCAG 2.2 AA criteria where applicable.

Verify actual rendered contrast rather than assuming token values are sufficient.

### Screen readers

Perform manual spot checks for:

- Navigation
- Dialogs
- Forms
- Survey flow
- Charts and alternatives
- Dynamic status messages

Automated accessibility scans are necessary but not sufficient.

Do not claim conformance without evidence.

---

## 18. Privacy-aware interface patterns

DevPulse must not visually imply that private information is broadly visible.

### Surveys

- Show approved privacy information before answering.
- Never display individual responses.
- Respect aggregation thresholds.
- Show insufficient-data states clearly.

### Skills

- Personal self-assessments remain person-owned.
- Do not expose private levels in team member cards.
- Do not introduce individual comparison charts.

### Goals

- Preserve existing visibility rules.
- Avoid gamified pressure or rankings.

### Conversations

- Preserve participant-only access.
- Do not introduce chat behavior without domain support.
- Keep notes and follow-up within existing authorized workflows.

### Administration

- Competency role profiles are not security roles.
- Do not add permission toggles based on visual references.

---

## 19. Component architecture

### Recommended structure

Adapt to the existing repository structure.

Example:

```text
components/
  ui/
    button/
    card/
    badge/
    input/
    dialog/
    tabs/
    empty-state/
    skeleton/
  layout/
    app-shell/
    sidebar/
    mobile-navigation/
    page-header/
    section-header/
  charts/
    chart-container/
    chart-empty-state/
    chart-legend/
  illustrations/
    empty-goals/
    empty-conversations/
    survey-complete/
```

This is a conceptual organization, not a requirement to restructure existing directories.

### Implementation principles

- Reuse existing components where appropriate.
- Prefer small, composable components.
- Avoid duplicated styling.
- Avoid premature abstractions.
- Preserve existing server/client boundaries.
- Keep domain logic outside purely visual components.
- Use semantic tokens.
- Test interactive behavior.

---

## 20. Design QA checklist

Before marking a page complete, verify the following.

### Visual

- [ ] Matches the approved visual direction
- [ ] Clear page hierarchy
- [ ] Consistent typography
- [ ] Consistent spacing
- [ ] Consistent radius and border treatment
- [ ] No unnecessary nested cards
- [ ] Clear primary action
- [ ] Appropriate content density
- [ ] Light theme verified
- [ ] Dark theme verified

### Functional

- [ ] Existing behavior preserved
- [ ] Real data used
- [ ] No invented features
- [ ] Loading states handled
- [ ] Empty states handled
- [ ] Error states handled
- [ ] Destructive actions correctly labeled
- [ ] No unauthorized data exposure

### Responsive

- [ ] 320px checked
- [ ] 360px checked
- [ ] 768px checked
- [ ] 1280px checked
- [ ] 200% zoom checked
- [ ] No unintended horizontal overflow
- [ ] Mobile navigation works
- [ ] Charts remain usable

### Accessibility

- [ ] Keyboard navigation checked
- [ ] Visible focus
- [ ] Semantic headings
- [ ] Accessible labels
- [ ] Contrast checked
- [ ] Reduced motion checked
- [ ] Automated scan completed where available
- [ ] Screen-reader spot check completed

### Engineering

- [ ] Typecheck
- [ ] Lint
- [ ] Relevant tests
- [ ] Build
- [ ] No new unauthorized domain behavior
- [ ] No weakened privacy guarantees
- [ ] Intentional deviations documented

Do not check items that have not actually been verified.

---

## 21. Implementation guidance for Claude Code

When implementing a page:

1. Read `DESIGN-README.md`.
2. Read this document.
3. Inspect the corresponding reference image.
4. Inspect the current implementation.
5. Identify the existing design tokens and shared components.
6. Determine which elements in the image are visual references only.
7. Implement using supported domain behavior.
8. Verify responsive and interactive states.
9. Compare the rendered result with the reference.
10. Record any deviations and remaining issues.

Do not treat generated screenshots as pixel-perfect requirements.

The objective is to achieve their level of polish while preserving real application behavior.

### Avoid design drift

Do not introduce new:

- Color systems
- Button styles
- Card treatments
- Typography scales
- Icon libraries
- Navigation patterns

without a documented reason.

### Avoid superficial redesign

A page is not redesigned merely because:

- Its background changed
- Its cards became rounded
- Its buttons became green
- More icons were added

The redesign must improve comprehension, navigation, and task completion.

---

## 22. Acceptance standard

The final DevPulse interface should look and behave like a cohesive premium SaaS product.

A successful implementation must demonstrate:

- Strong brand identity
- Clear visual hierarchy
- Useful information architecture
- Meaningful data presentation
- Accessible interactions
- Responsive layouts
- Consistent themes
- Privacy-respecting behavior
- Preserved domain functionality
- Verified browser quality

The system must be visually polished without becoming visually excessive.

**Clarity before decoration. Progress without pressure. Reflection with trust.**