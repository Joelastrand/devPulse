# DevPulse — Design Vision & Implementation Guide

**Status:** Approved visual direction — implementation reference  
**Product:** DevPulse  
**Design language:** Modern, warm, premium SaaS  
**Primary language:** Norwegian (Bokmål)  
**Primary experience:** Desktop web application  
**Critical mobile experience:** Pulse surveys  
**Design references:** `01`–`14` in this directory

---

## 1. Purpose

This document defines the visual identity, user experience principles, page-level design references, and implementation expectations for DevPulse.

DevPulse must feel like a mature, trustworthy SaaS product that organizations would confidently pay for.

The current application contains valuable functionality, but its presentation is often too sparse, text-heavy, form-oriented, and visually flat. Important product value is difficult to discover.

The redesign must address these problems through better information architecture, visual hierarchy, interaction design, contextual guidance, and meaningful data visualization.

**The goal is not simply to make the application prettier.**

The goal is to make DevPulse:

- Immediately understandable
- Professional and credible
- Pleasant to use regularly
- Visually distinctive without becoming distracting
- Useful for both individuals and teams
- Calm, respectful, and privacy-conscious
- Consistent across the entire application

### Core design promise

**Clarity · Progress · Reflection**

Users should understand where they are, what matters, and what they can do next.

---

## 2. How to use the design images

The images in this directory represent the **desired visual direction**, not exact technical specifications.

Claude Code must use them as visual references when implementing or improving each corresponding page.

### Source-of-truth hierarchy

When sources disagree, use this priority order:

1. Security, privacy, consent, authorization, and data-access requirements
2. Existing approved feature specifications and domain invariants
3. Actual supported backend capabilities and API contracts
4. This design document
5. The generated design images

**Never implement a feature merely because it appears in a generated image.**

The images may contain illustrative data, fictional users, charts, controls, permissions, percentages, dates, or features that do not exist in the application.

These elements must be validated against the actual product before implementation.

For example:

- A decorative notification bell does not authorize a notification system.
- A role-management mockup does not authorize a new permissions model.
- A progress percentage does not authorize calculating an employee performance score.
- A chat-like conversation mockup does not authorize creating a messaging system.
- A profile mockup does not authorize displaying private self-assessments to colleagues.
- An illustrated user avatar does not authorize exposing identity information.

When a design element cannot be supported by existing functionality, preserve the intended visual quality using a truthful alternative.

### Visual fidelity expectations

Aim for high fidelity in:

- Layout and composition
- Spacing and proportions
- Typography and hierarchy
- Color palette
- Navigation
- Cards and panels
- Button treatment
- Icons
- Content density
- States and feedback
- Responsive behavior

Do not reproduce:

- Imaginary features
- Unsupported metrics
- Invented personal information
- Incorrect privacy claims
- Fake interactions
- Misleading progress indicators

---

## 3. Design reference inventory

The following files should be stored together with this README.

| File | Route / experience | Design intent |
|---|---|---|
| `01-landing.png` | `/` | Public product introduction |
| `02-sign-in.png` | `/sign-in` | Clear, welcoming authentication |
| `03-app-home.png` | Authenticated home | Useful personal landing page |
| `04-teams.png` | `/teams` | Discover and navigate teams |
| `05-team-overview.png` | `/teams/[teamId]` | Team health and activity overview |
| `06-team-roadmap.png` | `/teams/[teamId]/roadmap` | Understand plans and what comes next |
| `07-my-skills.png` | `/me/skills` | Personal competency development |
| `08-my-goals.png` | `/me/goals` | Personal goals and follow-up |
| `09-conversations.png` | `/me/conversations` | Conversation overview |
| `10-conversation-detail.png` | `/me/conversations/[id]` | Focused development conversation |
| `11-admin-teams.png` | `/admin/teams` | Team administration |
| `12-admin-roles.png` | `/admin/roles` | Competency role profiles |
| `13-my-profile.png` | `/me/profile` | Personal profile and settings |
| `14-mobile-survey.png` | Survey answering flow | Mobile-first survey experience |

The filenames are the intended reference names. Verify that the actual files exist before implementation.

---

## 4. Brand identity

### Personality

DevPulse should feel:

**Professional, warm, thoughtful, confident, modern, human, and trustworthy.**

It should not feel:

- Like a generic administration dashboard
- Like an unfinished developer prototype
- Like a traditional enterprise HR system
- Like a social network
- Like an employee surveillance tool
- Like a gamified productivity application

### Visual inspiration

The design direction draws on the polish, clarity, and compositional quality commonly associated with mature SaaS products.

Use inspiration from products such as Linear, Notion, Stripe, Vercel, and leading people-development platforms.

Do not copy their layouts, branding, illustrations, or proprietary assets.

DevPulse needs its own recognizable identity.

### Signature visual elements

The approved visual direction uses:

1. A deep forest-green navigation sidebar
2. Warm off-white application surfaces
3. Restrained emerald-green accents
4. Rounded but structured cards
5. Clear, modern typography
6. Consistent outline icons
7. Subtle landscape-inspired illustrations
8. Generous but purposeful whitespace
9. Calm status colors
10. Strong visual hierarchy

The landscape motif symbolizes growth, perspective, continuity, and sustainable progress.

It must remain a supporting visual element rather than dominate every screen.

---

## 5. Color system

Use semantic design tokens rather than scattering hard-coded colors throughout components.

The following palette is an initial design target, not an instruction to replace existing tokens blindly.

### Primary palette

| Token | Suggested value | Purpose |
|---|---|---|
| `brand-950` | `#053F35` | Deep navigation background |
| `brand-900` | `#075446` | Sidebar and dark surfaces |
| `brand-800` | `#086A55` | Primary brand surfaces |
| `brand-700` | `#087B5B` | Primary actions |
| `brand-100` | `#DDF3E7` | Selected states |
| `brand-50` | `#EFF9F3` | Subtle accents |
| `canvas` | `#FAF9F6` | Main application background |
| `surface` | `#FFFFFF` | Cards and panels |
| `text-primary` | `#14242B` | Headings and primary content |
| `text-secondary` | `#50616B` | Supporting text |
| `border-subtle` | `#E5E9E6` | Dividers and card borders |

These values must be checked for accessible contrast in their actual usage.

### Status colors

Use semantic colors for meaningful states:

- Green: active, completed, confirmed
- Amber: planned, attention needed
- Red: error, destructive action
- Neutral gray: inactive, archived, unavailable
- Blue: informational state where appropriate

Never communicate meaning through color alone.

### Dark mode

DevPulse must retain fully functional dark mode.

Support:

- Light
- Dark
- Follow system

The generated images primarily illustrate the light theme and dark sidebar combination.

Dark mode must use equivalent semantic hierarchy, contrast, and component quality.

Do not implement dark mode by simply inverting colors.

---

## 6. Typography

Typography must create immediate clarity.

### Hierarchy

- Page title: prominent, confident, concise
- Page introduction: one short sentence explaining the page's value
- Section heading: clearly separated from body text
- Card title: strong enough to scan quickly
- Supporting metadata: visually quieter
- Form labels: clear and readable
- Helper text: concise and contextual

Use a modern sans-serif font with excellent Norwegian character support.

Prefer the existing project font if suitable. Otherwise evaluate a consistent replacement before changing it globally.

### Avoid

- Long unstructured paragraphs
- Excessive tiny helper text
- Multiple competing heading sizes
- Underlined links as the dominant interaction pattern
- Dense forms without grouping
- Oversized empty areas with no meaningful content

---

## 7. Layout system

### Desktop application shell

The main authenticated application should have:

- Persistent dark-green left sidebar
- Clear brand area
- Grouped navigation
- Distinct active state
- Main content region with intentional width
- Optional contextual top bar
- Clear page heading and primary action
- Consistent page padding

Navigation groups:

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

Only show navigation items the authenticated user is authorized to access.

### Mobile navigation

Replace the desktop sidebar with an accessible mobile drawer.

Requirements:

- Clear menu trigger
- Visible focus states
- Keyboard support
- Escape to close
- Focus management
- Proper scroll behavior
- No clipped navigation
- No horizontal page overflow

### Content widths

Different page types need different layouts.

Examples:

- Team overview: wide analytical workspace
- Roadmap: wide visualization area
- Skills: structured personal workspace
- Conversations: split view on desktop
- Forms: narrower focused content
- Survey: narrow, mobile-first interaction

Do not force every page into the same narrow centered column.

### Cards

Cards should organize information, not merely decorate it.

Use cards when they provide meaningful separation.

Avoid:

- Cards inside cards inside cards
- Excessive borders
- Every paragraph inside its own container
- Identical card layouts for unrelated content
- Large empty cards with one line of text

---

## 8. Interaction principles

### 8.1 Make the next action obvious

Each page should answer:

1. What is this?
2. Why does it matter?
3. What can I do here?
4. What should I do next?

### 8.2 Show value before configuration

Do not lead with a wall of settings or explanations.

Prefer:

- A useful overview
- Meaningful status
- Contextual guidance
- Relevant actions
- Details on demand

### 8.3 Progressive disclosure

Show essential information first.

Place advanced explanations, configuration, and secondary actions behind appropriate controls.

Do not hide privacy disclosures that must be presented before consent.

### 8.4 Meaningful motion

Use subtle transitions, approximately 100–200 ms where appropriate.

Respect `prefers-reduced-motion`.

Avoid decorative motion that distracts from tasks.

### 8.5 Feedback

Every meaningful interaction should provide appropriate feedback:

- Loading
- Success
- Error
- Empty state
- Disabled state
- Confirmation for destructive actions

Do not show fake success states.

---

## 9. Page specifications

### 9.1 Public landing page

**Reference:** `01-landing.png`  
**Route:** `/`

#### Goal

Immediately communicate what DevPulse is and why it matters.

The landing page should explain the product's value without requiring users to understand its internal feature names.

#### Desired experience

- Distinctive hero section
- Clear value proposition
- Strong primary CTA
- Warm, premium visual identity
- Short explanation of the product
- Privacy and trust messaging
- Responsive layout

#### Important

Do not make unsupported claims about anonymity, security certifications, or product outcomes.

Use approved privacy wording.

---

### 9.2 Sign-in

**Reference:** `02-sign-in.png`  
**Route:** `/sign-in`

#### Goal

Make authentication simple, predictable, and trustworthy.

#### Required behavior

- Unauthenticated users see the sign-in interface.
- Authenticated users should not remain on a redundant sign-in screen.
- Redirect authenticated users to the approved authenticated landing route.
- Preserve safe return destinations when applicable.
- Prevent open redirects.
- Do not show account-creation prompts as the primary content when the user is already signed in.

#### Design

- Focused authentication card
- Clear heading
- Appropriate supporting text
- Prominent primary action
- Good error feedback
- Strong keyboard accessibility

---

### 9.3 Authenticated home

**Reference:** `03-app-home.png`

#### Goal

Provide a useful starting point, not an almost empty welcome screen.

#### Desired experience

The home page should help users orient themselves and reach relevant work quickly.

Potential sections, **only where supported by real data**, include:

- Greeting and context
- My teams
- Personal goals
- Upcoming or active conversations
- Personal development shortcuts
- Relevant team activity
- Clear next actions

#### Authentication

Authenticated users must see authenticated navigation.

Do not display "Logg inn" or "Opprett konto" as if the user were signed out.

#### Route decision

Whether successful sign-in should land on the authenticated home page or `/teams` is a product decision.

Preferred direction: a useful authenticated home page with quick access to teams.

If home cannot yet provide meaningful value, `/teams` may be the simpler interim destination.

Do not introduce competing landing-page behavior across routes.

---

### 9.4 Team directory

**Reference:** `04-teams.png`  
**Route:** `/teams`

#### Goal

Make teams easy to discover and understand.

#### Desired experience

- Clear team list or card layout
- Meaningful team names
- Current user's relationship to each team
- Appropriate team status
- Easy navigation into a team
- Helpful empty state
- Search or filtering only if justified by actual usage and implemented correctly

#### Avoid

A large empty page containing only a few unstructured links.

Do not invent team health scores, member counts, or activity metrics.

---

### 9.5 Team overview

**Reference:** `05-team-overview.png`  
**Route:** `/teams/[teamId]`

#### Goal

Help a team understand its current situation and decide what to discuss or improve.

#### Suggested information hierarchy

1. Team identity and context
2. Latest pulse results
3. Trends over time
4. Competency areas
5. Competency needs and coverage
6. Roadmap and current plans
7. Challenges
8. Team membership

#### Visual design

- Meaningful overview at the top
- Strong chart presentation
- Consistent sections
- Clear navigation to deeper views
- Less repetitive text
- Better balance between summaries and details

#### Privacy

Preserve all aggregation thresholds and privacy conditions.

Never display individual survey responses.

Never invent values when data is unavailable.

When data is insufficient, show a clear and respectful insufficient-data state.

#### Existing runtime issue

Investigate and fix the React warning:

`Encountered two children with the same key, "2".`

The warning is reported while rendering `TeamDetail`, around the competency-needs and roster sections.

Do not assume the `key={generation}` props are necessarily the root cause.

Find the actual sibling collection with duplicate keys, fix the underlying identity problem, and add regression coverage.

---

### 9.6 Team roadmap

**Reference:** `06-team-roadmap.png`  
**Route:** `/teams/[teamId]/roadmap`

#### Goal

Make the team's plans understandable at a glance.

Users should immediately see:

- What is planned
- What is currently in progress
- What is completed
- What comes next
- Relevant dates
- Priorities
- Connections to competency areas

#### Visualization

Prefer a clear visual roadmap with meaningful grouping and progression.

A Gantt-style timeline may be appropriate if the existing data supports meaningful start/end dates and dependencies.

Do not force a Gantt chart if the domain only provides milestones or target dates.

Possible alternatives:

- Timeline
- Now / Next / Later
- Milestone-based roadmap
- Grouped plan cards with a visual status rail

Use the visualization best supported by the actual data model.

#### Required

- Accessible nonvisual alternative
- Clear status labels
- No misleading dates or progress
- Functional filters
- Mobile-friendly fallback

---

### 9.7 My skills

**Reference:** `07-my-skills.png`  
**Route:** `/me/skills`

#### Goal

Turn a static self-assessment form into a useful personal development workspace.

#### Desired experience

- Clear personal skills overview
- Meaningful grouping
- Readable proficiency levels
- Easy self-assessment
- Visual indication of assessed versus unassessed areas
- Role expectation comparison when a role is selected
- Contextual explanations
- Clear next actions

#### Privacy

Self-assessments are person-owned.

Do not expose them to teammates, managers, or administrators through new UI or API paths.

Do not turn proficiency levels into employee rankings or performance scores.

#### Role expectations

Users should be able to select from actual active role profiles where supported.

The interface must handle:

- No role selected
- No roles available
- Role selected
- Role archived or unavailable

Do not invent role expectations.

---

### 9.8 My goals

**Reference:** `08-my-goals.png`  
**Route:** `/me/goals`

#### Goal

Make personal goals feel purposeful and easy to maintain.

#### Desired experience

- Clear active goals
- Goal context
- Relevant target dates
- Meaningful completion states
- Easy editing
- Completed goals separated appropriately
- Connection to skill areas where supported

#### Avoid

- Gamification pressure
- XP or streaks
- Competitive rankings
- Invented progress percentages
- Productivity scoring

Only visualize progress when the data model actually supports it.

---

### 9.9 Conversations overview

**Reference:** `09-conversations.png`  
**Route:** `/me/conversations`

#### Goal

Make development conversations understandable and useful.

A conversation is a private, intentional space for reflection and follow-up between participating people.

#### Desired experience

- Clear distinction between conversations created by me and conversations I participate in
- Participant context
- Status
- Relevant date
- Shared goals when supported
- Clear creation action
- Easy navigation to conversation details

#### Important domain clarification

The visual reference shows a polished conversation workspace, but the current product must retain its actual conversation model.

Do not silently convert conversations into a real-time chat application.

Do not create fictional participants or expose information to nonparticipants.

Conversation participation, invitation, acceptance, and visibility must follow existing domain rules.

---

### 9.10 Conversation detail

**Reference:** `10-conversation-detail.png`  
**Route:** `/me/conversations/[id]`

#### Goal

Support a meaningful conversation between colleagues, with reflection and follow-up.

#### Desired experience

- Clear conversation title
- Participant context
- Date
- Notes
- Next steps
- Shared goals
- Completion state
- Clear save actions
- Strong desktop layout

#### Reference interpretation

The generated image uses a chat-like message layout.

**This is visual inspiration only.**

If the existing domain supports structured notes rather than chat messages, implement a polished structured conversation workspace instead.

Do not invent:

- Chat messages
- Real-time messaging
- Attachments
- Message history
- Notifications
- Read receipts

#### Privacy and encryption

Preserve participant-only access.

Preserve existing encryption paths and data-handling requirements.

Never bypass domain services to simplify the UI.

---

### 9.11 Admin — Teams

**Reference:** `11-admin-teams.png`  
**Route:** `/admin/teams`

#### Goal

Make team administration efficient and professional.

#### Desired experience

- Clear overview of existing teams
- Active/inactive states
- Easy team creation
- Accessible management actions
- Consistent confirmation patterns
- Better information density

#### Reference interpretation

The image contains multiple fictional teams and administrative tabs.

Do not invent teams or build new permissions, membership-management, or filtering capabilities unless separately approved.

Use actual data and supported operations.

---

### 9.12 Admin — Roles

**Reference:** `12-admin-roles.png`  
**Route:** `/admin/roles`

#### Goal

Make competency role profiles easy to create, understand, and maintain.

#### Critical distinction

**DevPulse role profiles describe competency expectations. They are not authorization roles.**

The generated reference image depicts permissions and access toggles.

Those controls must **not** be implemented as part of this redesign.

#### Correct domain representation

Role profiles should include only supported concepts such as:

- Role name
- Description
- Active/archived state
- Expected competency levels
- Associated competency areas
- Editing and archival

#### Desired layout

A split-view design may work well:

- Role list on the left
- Selected role details on the right
- Competency expectations presented visually
- Clear create/edit actions

Do not mix competency profiles with security permissions.

---

### 9.13 My profile

**Reference:** `13-my-profile.png`  
**Route:** `/me/profile`

#### Goal

Create a polished, trustworthy personal profile experience.

#### Desired experience

- Clear profile identity
- Editable display name
- Relevant team membership
- Simple settings
- Appropriate account actions
- Clear privacy boundaries

#### Reference interpretation

The image contains fictional contact details, biography, skill percentages, job title, and location.

These are not approved data fields.

Do not introduce or display them unless already supported and authorized.

Do not convert private self-assessments into a public employee profile.

Keep account erasure accessible and preserve its existing safeguards.

---

### 9.14 Mobile survey

**Reference:** `14-mobile-survey.png`

#### Goal

Make pulse surveys exceptionally easy to complete on a phone.

This is a critical product experience.

#### Desired experience

- One question per screen
- Clear progress indication
- Large touch targets
- Easy selection
- Back and Next navigation
- Visible completion state
- Minimal distractions
- Strong mobile readability

#### Privacy and session behavior

Show approved privacy information before answering.

Answers are retained only within the current page session as supported by the existing implementation.

Back and Next should preserve selections during that session.

Do not introduce draft persistence or autosave without separate approval.

Reloading or leaving the survey must not be represented as preserving answers if it does not.

#### Accessibility

- Keyboard-operable controls
- Clear labels
- Visible focus
- Screen-reader-friendly progress
- Reduced-motion support
- Responsive layout at narrow widths

#### Illustration note

The image is a device mockup.

Implement the actual responsive survey page, not a phone frame inside the application.

---

## 10. Data visualization

Visualizations should make information easier to understand, not merely make pages look more sophisticated.

### Appropriate visualizations

- Survey trends over time
- Competency coverage states
- Roadmap milestones
- Goal completion states
- Self-assessment levels
- Role expectation comparison

Only use data that exists and is authorized for the viewer.

### Avoid

- Employee performance scores
- Individual productivity rankings
- Team competition
- Artificial readiness scores
- Unsupported percentage values
- Charts that conceal missing data

### Chart quality requirements

- Clear titles
- Readable axes and legends
- Responsive layout
- Accessible labels
- Meaningful empty states
- Insufficient-data states
- Nonvisual alternatives where appropriate
- Consistent colors

For survey trends, insufficient response counts must remain gaps or explicitly unavailable states, never zeros.

---

## 11. Privacy and trust

Privacy is a product feature, not a footnote.

The redesign must preserve all existing privacy guarantees.

### Non-negotiable principles

- Individual pulse responses must not become visible.
- Aggregation thresholds must remain enforced.
- Personal skill assessments must remain private.
- Personal goals must retain their existing access restrictions.
- Development conversations must remain participant-restricted.
- Existing encryption must remain intact.
- New interface components must not create unauthorized data paths.
- The UI must not promise stronger anonymity than the implementation provides.

### Approved home privacy statement

> Svarene lagres uten navn eller e-postadresse. Individuelle svar vises aldri. Teamet ser bare samlede resultater, og først når nok personer har svart.

### Approved survey introduction

> Svaret ditt lagres uten navn eller e-postadresse. Teamet ser bare samlede resultater, og først når undersøkelsen er avsluttet og nok personer har svart.

Use approved privacy copy and preserve its meaning.

Do not shorten legally or privacy-significant statements simply to make the layout cleaner.

---

## 12. Icons and illustrations

### Icons

Use Lucide icons consistently.

Prefer:

- Outline style
- Consistent stroke weight
- Similar visual size
- Clear meaning
- Sparse usage

Avoid:

- Mixed icon libraries
- Random emoji
- Decorative icons beside every label
- Inconsistent filled and outline styles
- Whole-library imports

### Illustrations

Use the landscape-inspired identity sparingly.

Suitable placements:

- Public landing page
- Authenticated welcome area
- Selected empty states
- Survey completion

Avoid repeating the same large illustration on every card.

Illustrations must not interfere with content readability.

### Generated-image limitations

The reference images are not production assets.

Do not crop whole screenshots into UI elements.

Create original, reusable SVG or CSS-based visual assets where appropriate.

---

## 13. Responsive behavior

### Desktop: approximately 1280px and above

- Persistent sidebar
- Multi-column layouts where useful
- Rich charts
- Conversation split view
- Clear page-level actions

### Tablet: approximately 768px

- Adapted spacing
- Reduced columns
- Responsive charts
- Accessible navigation

### Mobile: approximately 360px

- Mobile drawer
- Single-column content
- Readable typography
- Large touch targets
- No unintended horizontal scrolling
- Simplified complex visualizations
- Focused survey flow

### Additional verification

Test:

- 320px viewport
- 360px viewport
- 768px viewport
- 1280px viewport
- 200% browser zoom

Do not claim responsive completion based solely on desktop screenshots.

---

## 14. Accessibility

Accessibility is a core quality requirement.

Implementation should include:

- Semantic HTML
- Correct heading hierarchy
- Accessible names
- Visible keyboard focus
- Logical tab order
- Keyboard-operable interactions
- Appropriate contrast
- Error identification
- Form labels
- Screen-reader-friendly status updates
- Reduced-motion support
- Responsive reflow

Run automated accessibility checks where available.

Also perform manual keyboard and screen-reader spot checks.

Do not claim WCAG conformance without appropriate evidence.

---

## 15. Engineering constraints

This redesign is primarily a UI/UX initiative.

Do not change unrelated architecture or business logic.

### Preserve

- Next.js App Router architecture
- TypeScript contracts
- Firebase authentication model
- Firestore server-side access patterns
- Existing authorization
- Existing encryption
- Feature boundaries
- Privacy thresholds
- Existing domain workflows
- Existing data ownership rules

### Do not introduce without approval

- New persistence models
- New authorization roles
- Employee scoring
- Gamification systems
- Notification infrastructure
- Real-time chat
- Unapproved profile fields
- New analytics metrics
- New personal-data exposure
- Changes to survey anonymity guarantees

### Component approach

Prefer reusable primitives for:

- App shell
- Page header
- Section header
- Buttons
- Cards
- Status badges
- Tabs
- Empty states
- Loading states
- Error states
- Chart containers
- Form fields
- Dialogs
- Navigation

Avoid unnecessary abstraction.

Components should reflect repeated design patterns, not speculative future needs.

---

## 16. Implementation workflow for Claude Code

Implement the redesign incrementally.

### Step 1 — Inspect

Before changing a page:

1. Read this README.
2. Open the corresponding reference image.
3. Inspect the existing route and components.
4. Inspect the actual data and API contracts.
5. Identify existing privacy and authorization requirements.
6. Identify supported and unsupported visual elements.

### Step 2 — Plan

For each page, document:

- Existing UX problems
- Desired visual improvements
- Supported data
- Components to reuse
- Components to create
- Responsive behavior
- Accessibility requirements
- Risks and constraints

### Step 3 — Implement

Build the page using the shared design system.

Do not reproduce a screenshot as a static image.

The result must be a functional, accessible interface.

### Step 4 — Verify

Run relevant:

- Type checking
- Linting
- Unit tests
- Component tests
- Integration tests
- Production build

Then verify the rendered UI in a real browser.

### Step 5 — Compare

Compare the actual page against its reference image.

Evaluate:

- Visual hierarchy
- Layout fidelity
- Typography
- Spacing
- Color consistency
- Content density
- Professional quality
- Interaction clarity
- Responsive behavior

Fix meaningful gaps before moving to the next page.

### Step 6 — Document

Record:

- What changed
- What was verified
- Which reference was used
- Any intentional deviations
- Remaining limitations
- Screenshots of the implemented result

Do not mark browser checks complete if they were not performed.

---

## 17. Recommended implementation order

Implement foundational design decisions before page-by-page polish.

### Phase A — Foundation

- Design tokens
- Typography
- Shared app shell
- Sidebar and top navigation
- Common components
- Light/dark themes
- Responsive patterns

### Phase B — Entry experience

1. Public landing
2. Sign-in
3. Authenticated home
4. Team directory

Fix authenticated routing and navigation inconsistencies here.

### Phase C — Team experience

5. Team overview
6. Team roadmap

Prioritize chart clarity, competency needs, coverage, and roadmap comprehension.

### Phase D — Personal development

7. My skills
8. My goals
9. Conversations
10. Conversation detail
11. My profile

### Phase E — Administration

12. Admin teams
13. Admin role profiles

### Phase F — Mobile survey

14. Survey experience

The mobile survey is high priority and may be implemented earlier when required.

### Phase G — Quality

- Responsive verification
- Accessibility verification
- Dark-mode review
- Visual consistency
- Error and empty states
- Performance review
- Final browser walkthrough

This sequence is a design recommendation, not authorization to override the existing feature task graph or release gates.

---

## 18. Definition of done

A page is not complete merely because it resembles the generated reference image.

It is complete when:

- The layout is polished and coherent.
- The page's purpose is immediately understandable.
- The primary action is clear.
- Actual data is represented accurately.
- Existing functionality still works.
- Privacy and authorization are preserved.
- Empty, loading, and error states are handled.
- Keyboard interaction works.
- Responsive behavior has been verified.
- Dark mode remains usable.
- Relevant tests pass.
- Browser evidence has been recorded.
- Intentional deviations are documented.

### Visual acceptance questions

Ask:

1. Would this feel credible in a paid SaaS product?
2. Can a first-time user understand its value?
3. Is the most important information easy to find?
4. Is the page visually balanced?
5. Are there unnecessary forms, borders, or blocks of text?
6. Does the design help the user make progress?
7. Does it feel calm and trustworthy?
8. Does it respect personal privacy?
9. Does it remain useful with little data?
10. Does it remain useful with substantial data?

If the page is technically correct but still feels like a prototype, it needs further design work.

---

## 19. Known issues to address

The following issues were observed in the existing application and should be tracked during implementation.

### Authentication

- Signed-in users can encounter a redundant sign-in page.
- Signed-in users may see signed-out navigation.
- Authenticated landing behavior needs to be consistent.

### Team overview

- Duplicate React key warning involving key `"2"`.
- Too much vertical scrolling through repeated containers.
- Important insights are difficult to identify quickly.

### Roadmap

- Current and next milestones are difficult to understand visually.
- The relationship between competency areas and plans needs clearer presentation.

### Skills

- Self-assessment currently feels like a long form.
- Role expectations need a stronger visual presentation.
- Empty role-profile states need useful guidance.

### Conversations

- The purpose of conversations is not sufficiently clear.
- The relationship between participants, notes, goals, and follow-up needs better presentation.
- The detail page needs a more focused desktop layout.

### Administration

- Team and role administration feel visually sparse.
- Role profiles must remain separate from authorization roles.

### General

- Too much unused whitespace
- Inconsistent information density
- Weak visual hierarchy
- Limited illustration and brand character
- Too many text-heavy sections
- Insufficient contextual guidance

---

## 20. Final design principle

**DevPulse is not a tool for measuring people. It is a workspace for understanding team health, supporting development, and making thoughtful progress.**

The interface should make that distinction visible.

Use the design references to achieve a premium SaaS experience, but always prioritize truth, clarity, privacy, accessibility, and useful functionality.

**Build the product shown by the design direction — not the fictional features accidentally depicted in the generated images.**
