# Team Forum (Phase 6 — Developer Forum Capabilities, v1 slice)

## Status
Approved — Phase 6 v1 slice implemented (TASK-001 through TASK-006 Done;
see `TASKS.md`).

**Feature flag (current-state addendum).** The Forum feature described below
remains fully implemented and unchanged, but its UI is now **hidden by
default** on `/teams/[teamId]` and its standalone `/teams/[teamId]/forum/
[threadId]` thread-detail page, behind a server-only product/UI-availability
flag: `FEATURE_FORUM_ENABLED` (`src/features/forum/server/
is-forum-enabled.ts`). Set it to exactly `"true"` to show the Forum UI again;
a missing, `"false"`, or any other value hides it (fails closed). This is a
**product/UI-availability decision, not a security control** — every
guarantee described in this document (server-side authorization, encryption,
attribution, deletion semantics) is unaffected, and `src/features/forum/
server/*` and every `/api/teams/[teamId]/forum/...` route remain reachable
and unchanged regardless of this flag's value; a caller who already knows a
thread's API shape sees identical authorization behavior either way. See
`docs/DEVELOPMENT.md`'s environment-variable table for the flag's exact
semantics and where it is read.

**Revision note (planning-review remediation pass).** An independent
planning review found that this document's original two "Open questions"
(member-visible email exposure; indefinite retention of unreadable deleted
ciphertext) were being treated as resolved defaults throughout the document
while `TASKS.md` left the tasks that would implement them `Ready` and
ungated — i.e. implementation could have silently locked in both answers.
The product owner has now made both decisions explicitly (see "Owner
decisions" immediately below); this revision replaces the two open
questions with those decisions and reworks every affected section
(identity/attribution model, data model, lifecycle/moderation, server
operations, DTOs, BRs, tests) to match. A third gap the same review
surfaced — content beyond the reply read-window becoming permanently
undeletable, not merely unreadable — is also fixed here (see "Query/index
model" and "Reply capacity"). BR numbers are preserved where the
requirement survives (even if reworded); genuinely new requirements are
appended as BR-50 and up, per this repository's stable-numbering
convention.

### Owner decisions
- **Decision 1 (identity/attribution)**: ordinary team members must never
  receive another member's email address merely by participating in the
  forum. Attribution remains real (not anonymous), but the member-visible
  display value is a deterministic, non-contact-reachable pseudonymous tag
  computed from `(teamId, authorUid)` — never an email, real name, or raw
  `uid`. See "Identity/attribution model."
- **Decision 2 (deleted-content retention)**: deleted forum content must
  not retain encrypted text indefinitely with no application actor ever
  able to read it again. Thread deletion is now a genuine hard delete
  (thread document and all its replies are actually removed from
  Firestore, cascading, not hidden behind a parent-existence check); reply
  deletion (outside a thread cascade) is a content-erasing tombstone that
  removes `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` from the
  document rather than merely withholding them from a response. See
  "Lifecycle/moderation" and "Data model."

**Feature id note**: `docs/ROADMAP.md` labels this phase "Developer Forum
Capabilities" and `docs/PRODUCT.md` speaks of "Developer forums/
communities." This document scopes a deliberately smaller v1 — a
**team-scoped** threaded discussion board, not a cross-team/org-wide
"developer community." The feature id is therefore `team-forum`, not
`developer-forum`, to name what v1 actually is rather than the larger
phase-level ambition — the same simplification `docs/ROADMAP.md`'s own
"Managed Surveys & Survey-Based Insights" → `managed-surveys` and "Multi-team
management" → `team-management` already establish as this repository's
convention. A future phase could extend this into a cross-team/org-wide
"developer forum" as a distinct, separately planned feature; nothing in this
document forecloses that, but nothing here builds toward it speculatively
either.

## Context
DevPulse currently senses team wellbeing/delivery health through structured
pulse surveys (`docs/features/managed-surveys/SPEC.md`) and anonymous
free-text challenges (`docs/features/anonymous-challenges/SPEC.md`). Both are
deliberately **identity-free** — the entire point of each is that content is
never traceable to a submitter. Neither gives a team an ordinary,
attributed, back-and-forth discussion channel: a place to ask "has anyone
solved X," propose an idea, or discuss a challenge someone raised, with
normal conversational attribution (so a reply can be recognized as coming
from the same person as an earlier post, and a thread has a recognizable
owner).

This is architecturally significant: **every prior feature in this codebase
was built around never persisting or displaying submitter identity to
anyone but an app admin acting in a narrow, already-scoped context**
(`listTeamMembers`, admin-only). This feature is the first where persisted,
member-visible author attribution is the deliberate point, not a
near-miss to avoid. Precedent from surveys/challenges (anonymity
guarantees, participation/response separation, minimum-response
aggregation) does not apply here and must not be copied by default — see
"Identity/attribution model" below for what is reused from precedent
(server-side authorization boundaries, DTO minimization discipline,
encryption-at-rest mechanics) versus what is intentionally different
(attribution itself, now pseudonymous per Owner Decision 1 rather than
real-name/email, per the initial draft this revision replaces).

## Goals
- Let a real member of a team start a titled discussion thread and reply to
  one, scoped to that team, with ordinary attribution — a reader can tell
  which posts share an author, even though (per Owner Decision 1) they
  cannot necessarily tell that author's real name or contact them directly
  from that fact alone.
- Let any member/admin of a team read that team's threads and replies.
- Give an author (or an app admin) a minimal way to remove a thread or
  reply they no longer want visible, without inventing a moderation
  platform, and without retaining a permanent, unreadable copy of removed
  content for no concrete reason (Owner Decision 2).
- Preserve every existing privacy/security invariant this codebase already
  enforces that still applies to attributed content (server-side
  authorization, team isolation, no client-side Firestore access,
  application-level encryption at rest for free text, DTO minimization) —
  while being explicit about the one guarantee that does **not** carry over
  from surveys/challenges: authorship *continuity* is not hidden here, by
  design, even though real-world identity (name, email) is not disclosed
  through this feature.

## Non-goals
- **Org-wide/cross-team forum or discovery.** Every thread/reply is scoped
  to exactly one team, exactly like every other feature in this codebase.
  A cross-team "developer community" is a distinct, future, separately
  planned feature (see "Feature id note" above).
- **Real-name/email attribution.** Superseded by Owner Decision 1: a v1
  reader sees a pseudonymous per-team tag, not a name or email address. A
  genuine display-name/profile system (letting a user choose a name other
  team members would see) is explicitly out of scope for v1 — building one
  merely to support this feature would be exactly the kind of
  speculative, oversized v1 the planning brief asks to avoid. If real-name
  attribution is wanted later, it is a distinct, separately planned
  feature layered on top of the `authorUid`/`isOwnThread`/`isOwnReply`
  mechanism this spec already establishes, not a schema change to this one.
- **Editing.** A thread's title/body and a reply's body are immutable from
  creation until deletion. Rejected for v1: edit history/version tracking,
  "was this edited" indicators, and the moderation question of whether an
  edit after replies exist should be restricted, all add real complexity
  for no product need identified yet — delete-and-repost is an acceptable
  v1 workaround, mirroring how Anonymous Challenges also has no edit.
- **Nested/threaded replies.** Replies are a flat, single-level list under
  a thread — no reply-to-reply nesting, no quoting.
- **Reactions, voting, or a reply/reaction count on the thread list.**
  Evaluated and rejected: no product need identified yet, and a reaction
  count on a mutable list would introduce exactly the kind of denormalized
  counter/transaction complexity this spec otherwise avoids entirely (see
  "Data model").
- **Categories, tags, or pinning/locking a thread.** No product need
  identified yet for a first team-scoped forum.
- **Attachments, mentions, or notifications.** Out of scope; would each
  introduce their own storage/identity/delivery concerns beyond a v1 text
  discussion board.
- **Search.** No product need identified yet at expected team-forum volume;
  would also interact with the encryption decision below (see "Privacy/
  security model" → "Encryption/content classification").
- **Rich text or Markdown rendering.** Content is plain text only (see
  BR-22) — this is also a deliberate security simplification (no
  stored-XSS surface), not only a scope cut.
- **A moderation queue, reporting/flagging flow, or admin visibility into
  deleted content.** No surface in v1 lets anyone — including an app
  admin — read a deleted thread's or reply's content again, and (per Owner
  Decision 2) a deleted thread's content no longer exists anywhere to be
  read. A structured moderation/audit product can be designed later if real
  usage shows a need.
- **True pagination.** Bounded response sizes stand in for pagination in
  v1 (200 threads per team; every reply of a thread, itself capped at 500
  per thread at creation time — see "Reply capacity"). This is now a
  genuine capacity limit with enforced creation-time behavior for replies,
  not merely a read-side display cutoff — see "Query/index model."
- **Rate limiting / anti-abuse tooling.** Creation requires real,
  authenticated team membership (no public/anonymous path), which already
  removes the anonymous-abuse surface Managed Surveys' `public` mode has to
  accept. Residual abuse (a real member posting excessive junk) is
  accepted, undefended, for v1 — mirrors Anonymous Challenges' identical
  choice.
- Skill/Capability Tree behavior (Phase 7).

## Terminology
- **Thread**: a titled, team-scoped discussion topic, created by a real
  team member, containing zero or more replies.
- **Reply**: a piece of content attached to exactly one thread, in flat
  (non-nested) chronological order.
- **Author**: the verified identity (`uid`) that created a thread or
  reply — persisted as `authorUid`, never as email/display name (see
  "Identity/attribution model").
- **Author tag**: a deterministic, non-contact-reachable, pseudonymous
  label computed purely from `(teamId, authorUid)` and shown to any
  authorized reader at read time — see "Identity/attribution model" →
  "Author tag derivation." Replaces this document's original "author
  display" concept (Firebase Auth email, live-resolved), which Owner
  Decision 1 rejected.
- **Tombstone**: the terminal, content-erased state a deleted *reply* is
  left in — the Firestore document still exists, stripped of every
  content-bearing and identity field, solely to preserve its position in
  the reply list (BR-26). A deleted *thread* has no tombstone state at
  all — its document, and every one of its replies' documents, is
  genuinely removed (see "Lifecycle/moderation").
- **Real team membership**: an actual `teamMemberships/{uid}__{teamId}`
  record, as distinct from `authorizeTeamAccess`'s broader
  `"admin" | "member" | "denied"` result — reused unchanged from
  `docs/features/anonymous-challenges/SPEC.md`'s identical definition,
  applied here to thread/reply **creation** specifically (not to reading).

## Product behavior
1. A signed-in user who is a real member of Team X opens `/teams/{X}` and
   sees a "Forum" section: a list of the team's threads (title, author
   tag, date), newest-first, and a "start a new thread" action.
2. Creating a thread requires a title and a body; on success, the caller is
   taken to the new thread's detail view.
3. Any member/admin of Team X (including an app admin without real
   membership, via the same broader `authorizeTeamAccess` viewing boundary
   every other team surface already uses) can open a thread to read its
   body and its replies, oldest-first.
4. A real team member can reply to a thread from its detail view, as long
   as the thread has not reached its 500-reply capacity (see "Reply
   capacity"); the reply list refreshes to show it (authoritative refresh,
   not an optimistic local insert — mirrors the established
   `ChallengeSubmissionPanel`/`TeamDetail` refresh pattern).
5. A thread's own author, or an app admin, can permanently delete that
   thread — this genuinely removes the thread and every one of its replies
   from Firestore, not merely from view, for everyone, including admins. A
   reply's own author, or an app admin, can delete that one reply — the
   thread and its other replies are unaffected; the deleted reply is
   replaced by a content-free tombstone placeholder in its original
   position (its encrypted content is erased from the document, not merely
   withheld from display).
6. A non-member sees no forum content or data — the existing non-sensitive
   "request access" state, unchanged.
7. There is no separate admin-only forum surface — `/admin/teams/[teamId]`
   is not extended by this feature; an app admin moderates from the same
   `/teams/[teamId]` forum UI every member uses, using the delete action
   BR-40 grants them there. (Unlike Anonymous Challenges, there is no
   admin-only "see everything including archived" view to build, because
   deleted content is never visible to anyone, and a deleted thread's
   content no longer exists to be visible — see "Lifecycle/moderation.")

## Identity/attribution model
This is the load-bearing design decision for this feature; it is not
inherited from any existing precedent, and it has been revised once
already (Owner Decision 1) after a planning review found the original
draft's design — showing a poster's real, current email address to every
fellow team member — was an unauthorized, newly-introduced exposure with
no documented product basis.

- **Attribution is pseudonymous-but-consistent, not real-name, and not
  anonymous.** A thread/reply is created by a verified Firebase identity;
  fellow team members see a stable per-team tag for that identity — enough
  to recognize "the same person wrote these two posts," not enough to
  learn who that person actually is (their name, email, or any other
  contact-reachable value). This is narrower attribution than the
  product's original framing ("a reader can see who wrote what") — see
  "Non-goals" → "Real-name/email attribution" for why building real-name
  attribution is deliberately deferred rather than solved here.
- **Canonical persisted identifier**: `authorUid` (the creator's Firebase
  `uid`) — the only identity-shaped field ever persisted on an *active*
  thread/reply document (a content-erased reply tombstone has none at
  all — see "Data model"). No email, display name, or other identity field
  is stored alongside content.
- **Author tag derivation.** `authorTag = uppercase(hex(SHA-256(
  \`${teamId}:${authorUid}\`)).slice(0, 6))` — a pure, deterministic,
  no-I/O function of `(teamId, authorUid)` alone, implemented as a plain
  domain function (`src/features/forum/domain/author-tag.ts`, no Firestore
  or Firebase Auth call). Precise properties, specified so implementation
  cannot improvise:
  - **Inputs**: exactly `teamId` and `authorUid`, both already
    server-trusted values at every call site (the route's own scope and
    the persisted `authorUid`, respectively) — no other input, no secret
    key, no environment-dependent salt.
  - **Same author, same team → same tag, always.** Every thread/reply the
    same `authorUid` creates within one team shows the identical
    `authorTag`, letting a reader recognize authorship continuity within
    that team's conversation.
  - **Same author, different teams → different tags.** `teamId` is part of
    the hash input, so the same person's tag in Team A reveals nothing
    about, and never matches, their tag in Team B — this also means a
    multi-team member cannot be correlated across teams by tag alone.
  - **Never reveals `uid` or email.** The tag is a truncated one-way hash
    digest; recovering `authorUid` from it would require brute-forcing
    Firebase's 28-character random uid space, which is not practically
    feasible, and the tag contains no substring or encoding of the uid or
    any other identity field.
  - **Requires no new persisted field.** Computed on demand at read time
    from data every read operation already has (`teamId`, `authorUid`) —
    no new collection, no assignment step, no migration.
  - **Collision expectations.** 6 hex characters = 24 bits ≈ 16.7 million
    possible tags. For a team with `N` distinct authors, the expected
    collision probability is approximately `N²/2²⁵` (birthday bound) — for
    example, ≈0.007% for a 50-author team, ≈0.75% for an (unrealistically
    large) 500-author team. A collision is an **accepted, extremely
    low-probability residual risk**: at worst, two different authors'
    posts appear under one indistinguishable tag — a display ambiguity,
    never an identity leak (nothing about who either author is becomes
    knowable either way). If this is ever judged insufficient, widening the
    hash slice (e.g. to 8 hex characters) requires no schema change or
    data migration, since nothing is persisted.
  - **Behavior if the Firebase Auth user no longer exists.** Unaffected —
    the tag depends only on `(teamId, authorUid)`, never on a live
    Firebase Auth lookup, so it is exactly as stable after the author's
    account is deleted as before. This eliminates the entire
    "author-display degrades to a placeholder" case the original
    email-based design needed (see "What changed from the original
    email-based design" below).
  - **Stability**: permanent for the life of the `(teamId, authorUid)`
    pair — never mutated, never re-derived differently later, and
    unaffected by the author's email changing, display name (if one is
    ever added later), or team-membership status.
- **What changed from the original email-based design.** The original
  draft resolved a live Firebase Auth email lookup per `authorUid`
  (reusing `listTeamMembers`' mechanism, but extended from admin-only to
  member-visible) and needed an explicit "degrades to a placeholder if the
  account no longer resolves" case. The pseudonymous-tag design needs no
  such case at all, no Firebase Auth I/O, and no admin-only precedent
  extension — it is a strictly smaller, more robust mechanism than the
  design it replaces, not merely a substituted value behind the same
  machinery.
- **What ordinary members can see**: any authorized team reader (member or
  admin, via `authorizeTeamAccess`) sees the identical `authorTag` for the
  same thread/reply — there is no member-vs-admin difference in what
  identity information is shown.
- **`authorUid` is never exposed to any client DTO.** A reader learns only
  `authorTag` and a boolean `isOwnThread`/`isOwnReply` flag (computed
  server-side by comparing the persisted `authorUid` to the caller's own
  verified `uid`) — never the raw `authorUid` itself (BR-13), and never any
  email address (BR-49, revised). This lets the UI show a "delete"
  affordance on the caller's own content without ever handing the browser
  a stable identity handle, or any contact-reachable value, it doesn't
  need.
- **Is author identity "sensitive metadata"?** The *fact that two posts
  share an author* is shown, by design, to anyone already authorized to
  read the content — that is this feature's purpose. The author's *real
  identity* (name, email, uid) is not disclosed by this feature to anyone
  but an app admin acting through existing, unrelated admin surfaces
  (`listTeamMembers`) — this feature adds no new path to it.
- **Four distinct identity concepts, kept separate throughout this
  document** (a planning-review check item): (1) **authorization
  identity** — the verified `uid` from `verifyIdToken`, used for every
  authorization decision; (2) **persisted author identity** —
  `authorUid`, the only identity field ever written to a thread/reply
  document; (3) **member-visible display identity** — `authorTag`, the
  pseudonymous, non-reversible value shown to readers; (4) **admin/audit
  identity** — `deletedBy` (a reply tombstone's acting-deleter uid,
  persisted for internal accountability only, never returned by any API
  response — BR-28). No code path in this feature ever conflates two of
  these — in particular, `authorTag` is never derived from, or convertible
  back to, `authorUid`.
- **`isOwnThread`/`isOwnReply` are always computed server-side** by
  comparing the caller's verified `uid` (concept 1) against the document's
  persisted `authorUid` (concept 2) — never accepted as a client-supplied
  boolean, and there is no request shape anywhere in this feature that
  could carry one.

## Privacy/security model
Threat-model categorization, mirroring `docs/features/anonymous-challenges/
SPEC.md`'s convention: **(A)** guarantee enforced by application
architecture, **(B)** residual risk that cannot reasonably be eliminated,
**(C)** explicitly accepted product tradeoff, **(D)** future hardening, out
of scope for v1.

| # | Risk | Category | Notes |
|---|---|---|---|
| 1 | Cross-team reads | A | Every read operation requires `authorizeTeamAccess` for the route-scoped `teamId`, and every returned document's own persisted `teamId` is cross-checked against that scope (BR-18, BR-35). |
| 2 | Cross-team writes | A | Creation requires real membership scoped to the route `teamId` (BR-1); management (delete) operations cross-check the target's own persisted `teamId` and reject a mismatch (BR-32). |
| 3 | Forged author identity | A | `authorUid` is always the server-verified caller's own `uid` from `verifyIdToken` — never a client-supplied field of any kind (BR-2, BR-47). |
| 4 | Admin-without-membership participation | A | `requireAppAdmin` alone is insufficient to create a thread/reply — real `teamMemberships/{uid}__{teamId}` is required (BR-1), mirroring Anonymous Challenges BR-1 exactly. |
| 5 | Stale membership | A | Creation re-checks real membership and team status fresh on every call; reading and deleting one's own content are deliberately *not* re-gated on current membership (BR-14 and "Edge cases" — an ex-member's past content and its ownership persist). |
| 6 | Disabled teams | A | Creation is blocked (BR-7); reading and deletion are unaffected (BR-21, BR-31) — mirrors Anonymous Challenges' "Team-disable semantics" exactly. |
| 7 | Malformed Firestore documents | A | Fail-closed validators exclude a malformed reply/thread from a listing rather than trusting or crashing on it (BR-20). |
| 8 | Client-supplied audit/identity fields | A | `authorUid`, `deletedAt`, `deletedBy`, `threadId`/`replyId` are never accepted from a request body (BR-2, BR-47). |
| 9 | DTO overexposure | A | Every DTO is an explicit, minimal, hand-built shape — `authorUid`, `deletedBy`, and the encrypted fields never appear in any response (BR-13, BR-28). |
| 10 | UID leakage | A | Never included in any DTO (BR-13). |
| 11 | Real-identity (name/email) exposure to fellow team members | A | Superseded by Owner Decision 1 — `authorTag` is architecturally incapable of carrying an email/name/uid (BR-49, revised); this is now a prevented threat, not an accepted tradeoff. |
| 12 | Direct client Firestore access | A | `firestore.rules` deny-all blocks for both new collections (BR-33), identical in form to every existing collection. |
| 13 | Stored XSS / unsafe rich content | A | Plain-text-only rendering, no HTML/Markdown interpretation anywhere (BR-22) — architectural, not sanitization-based, and exercised by a runtime rendering test, not only a source-code absence check (see "Testing strategy"). |
| 14 | Logging of forum content | A | No operation logs plaintext/ciphertext on any path (BR-36). |
| 15 | Deleted content becoming decryptable again | A | A hard-deleted thread's content no longer exists anywhere to decrypt (BR-24, BR-25); a tombstoned reply's encrypted fields are removed from the document, not merely withheld (BR-26) — decryption of deleted content is architecturally impossible, not merely unauthorized. |
| 16 | Enumeration/discovery | A | Opaque, non-guessable auto-generated IDs; a cross-team, deleted, or never-existed `threadId` yields the identical `not_found` outcome (BR-16) — no existence oracle. |
| 17 | Spam/flooding | C | No rate limiting in v1 — bounded by real-membership-gating only, mirrors Anonymous Challenges' identical accepted posture. |
| 18 | Concurrent mutations | A/C | Reply-tombstone deletion is idempotent (BR-27); thread hard-delete-plus-cascade has one narrow, documented residual race (BR-55, category B/C — see "Edge cases"); the 500-reply cap is enforced best-effort, not transactionally (BR-53, category C). |
| 19 | Unbounded collection growth | C | `listTeamThreads` returns only the 200 most recent threads per team (BR-19) — an explicit, intentional visibility bound (not an addressability one: an older thread's `threadId`, once known, remains directly deletable — see "Query/index model"). Reply growth is now a genuine, enforced creation-time capacity limit (BR-52), not merely a read-side cutoff, so no reply ever becomes unreachable by falling outside a window. |
| 20 | Free text containing identifying/sensitive information about a third party | C/D | Cannot be architecturally prevented; mitigated only by UI copy warning against it. No automated scanning exists or is planned for v1. |

### Encryption/content classification
**Decision: forum thread/reply content is encrypted at rest, reusing
`src/lib/encryption/encryption.ts` unchanged (option A from the planning
brief) — the same mechanism `surveyResponses` and `challenges` already
use.** (Unaffected by this revision — recorded here unchanged from the
original planning pass.)

Rationale:
- **Product semantics, not just precedent.** A forum thread can easily
  discuss the same kind of sensitive workplace-friction content Anonymous
  Challenges exists to capture ("our on-call rotation is unsustainable,"
  a reply naming a specific process failure) — `docs/SECURITY.md`
  invariant 13 ("anonymous free-text challenges/comments are treated as
  highly sensitive") is written narrowly around *anonymous* content, so it
  does not directly mandate this for attributed forum text, but the
  underlying product reality (free-text organizational-friction content)
  is the same in kind. Treating forum text as ordinary, unencrypted
  application data purely because it happens to be attributed would be an
  inconsistent, convenience-driven distinction with no security rationale
  behind it.
- **Attribution and content-secrecy are independent axes.** Encrypting the
  *content* does nothing to change who the *author* is shown to be — the
  two decisions don't trade off against each other. Encrypting here loses
  nothing this feature needs.
- **No query/search requirement is blocked.** v1 has no full-text search
  (explicit Non-goal) and every read path queries only by `teamId`/
  `threadId` (never by content) — see "Data model" → "Query/index model."
  Encrypting the content field therefore costs nothing functionally.
- **Trust boundary is unchanged.** The server already decrypts content to
  serve it to authorized readers (exactly like `challenges`); an operator
  with only raw Firestore/console access sees ciphertext, not plaintext,
  same as every other sensitive collection — encryption adds real defense
  against that specific access path without adding any new operational
  complexity (same key, same module, same fail-closed behavior on a
  missing/invalid `ENCRYPTION_KEY`).
- **Operational complexity is minimal**: this is a straight reuse of an
  already-implemented, already-tested module — no new key material, no new
  configuration.

This is recorded as a resolved decision for v1, not an open question — the
reasoning above is derivable from existing policy and precedent without
requiring a new product decision.

**Note on `src/lib/encryption/encryption.ts`'s own docstring (resolved at
TASK-006).** A planning review found `decrypt()`'s docstring claimed
callers must be "server-side, authorized aggregation code... never a route
handler returning decrypted content directly to a client" — already
inaccurate for Anonymous Challenges (which does exactly this) and inaccurate
for this feature too. `TASKS.md`'s TASK-006 closeout corrected the
docstring to describe the general rule accurately (server-side/authorized-
only, with whether decrypted content may then reach a client left as a
per-feature product decision) rather than special-casing any one feature —
`encrypt()`/`decrypt()`'s own behavior is unchanged.

## Data model
Two new collections, following this codebase's established "server-only,
Admin-SDK-only, deny-all client rule, opaque generated ID" pattern. **Field
shapes below are revised from the original planning pass per Owner
Decision 2** — a thread has no tombstone shape at all (deletion removes the
document), and a reply's post-tombstone shape has its content-bearing and
identity fields actually removed, not merely flagged.

```
forumThreads/{threadId}
    teamId: string
    authorUid: string
    ciphertext: string   // decrypts to JSON {title: string, body: string}
    iv: string
    authTag: string
    keyVersion: "v1"
    createdAt: Timestamp
```

There is no `deletedAt`/`deletedBy` field on `forumThreads` — a thread is
either an existing document (active) or it does not exist at all (deleted).
See "Lifecycle/moderation."

```
forumReplies/{replyId}          // shape while active
    teamId: string       // denormalized from the parent thread at creation
                         // time; independently cross-checked on every read/
                         // management operation (BR-35), never trusted
                         // solely because the query was scoped by threadId
    threadId: string
    authorUid: string
    ciphertext: string   // decrypts to plain body text (no JSON wrapper —
                         // a reply has no title)
    iv: string
    authTag: string
    keyVersion: "v1"
    createdAt: Timestamp
```

```
forumReplies/{replyId}          // shape after deleteReply (tombstone)
    teamId: string        // retained — needed for BR-35's cross-check on
                          // any future access attempt
    threadId: string      // retained — needed to keep its position in
                          // getThreadWithReplies's reply list (BR-26)
    createdAt: Timestamp  // retained — needed for ordering (BR-17)
    deletedAt: Timestamp  // new
    deletedBy: string     // new — uid of whoever deleted it (the author or
                          // an acting admin); internal accountability
                          // only, never returned by any API response
                          // (BR-28)
    // authorUid, ciphertext, iv, authTag, keyVersion: REMOVED
    // (Firestore FieldValue.delete() on each) — not merely absent from a
    // response, absent from the document. Nothing in this document can be
    // decrypted, because there is nothing encrypted left in it (BR-26,
    // BR-56).
```

**Why one combined `ciphertext` for a thread's title+body, not two
encrypted fields.** Keeps the field count identical to every other
encrypted collection in this codebase (`surveyResponses`, `challenges`:
`ciphertext`/`iv`/`authTag`/`keyVersion`) rather than doubling it. The
decrypted JSON is validated (both `title` and `body` present and
well-typed) by the same fail-closed domain validator used for every other
malformed-record case (BR-20) — a decrypted-but-malformed payload is
treated identically to any other malformed record, never partially trusted.

**No other collection is introduced.** Evaluated and rejected:
- **A denormalized `replyCount` on `forumThreads`**: would require a
  transaction on every `createReply` (read parent, increment counter,
  write reply) to avoid a lost-update race under concurrent replies. No
  product need for a reply count in the thread list was identified for v1
  (see Non-goals). The 500-reply cap check (BR-52) instead uses a Firestore
  count-aggregation query (`.count()`) at write time — a read, not a
  denormalized field, so it introduces no new counter to keep consistent
  and needs no transaction (see "Reply capacity").
- **A separate "author" or "attribution" collection**: unnecessary —
  `authorUid` alone is sufficient for authorization/ownership, and
  `authorTag` needs no storage at all (pure function of `(teamId,
  authorUid)`); there is nothing to separate out the way
  `SurveyParticipation` had to be separated from `SurveyResponse` (that
  split existed solely to support a dedup check with no shared
  identifier — this feature has no dedup requirement at all, BR-9).
- **A coordination document** (like `teamSurveyState`): no "at most one"
  invariant exists for threads/replies to protect.

`threadId`/`replyId` are Firestore auto-generated document IDs (`.add()`),
never client-supplied, never deterministic.

### Reply capacity
**New in this revision**, resolving the planning-review finding that a
reply falling outside `getThreadWithReplies`'s read window could become
permanently unreadable *and* undeletable (since `createReply` returns no
`replyId` a client could otherwise use to address it directly).

- **BR-52**: `createReply` is rejected with a distinct `thread_full`
  outcome once the target thread already has 500 replies, checked via a
  Firestore count-aggregation query (`forumReplies.where("threadId","==",
  threadId).count().get()`) — a cheap read that does not fetch document
  contents, and requires no new index beyond the existing single-field
  equality index on `threadId`.
- This is a genuine v1 **capacity limit enforced at creation time**, not
  merely a read-side display cutoff: because a thread can never exceed 500
  replies, `getThreadWithReplies` can always return *every* reply belonging
  to a thread (see "Query/index model") — there is no reply a normal read
  fails to show, and therefore no reply that becomes unreachable to
  address for deletion. This directly replaces the original design's
  accepted residual risk on this point (see "Accepted residual risks").
- **BR-53**: the cap is enforced on a best-effort, non-transactional
  basis — two replies created concurrently when a thread is at exactly 499
  replies could both pass the count check, producing up to one reply over
  the nominal 500 cap. This is an accepted, extremely narrow residual risk
  (not a correctness requirement anything else in this feature depends
  on — `deleteThread`'s cascade, BR-54, is explicitly designed to remain
  correct regardless of whether this rare race ever occurs).
- **Threads are not capacity-limited** — only `listTeamThreads`'s 200-row
  *visibility* window applies to threads, and it does not create an
  addressability problem the way the original reply-read-window did:
  `createThread` already returns `threadId` (BR-6's return contract is
  unchanged for threads), so a thread's own author retains a durable
  handle to it (e.g. its detail-page URL) even after it ages out of
  `listTeamThreads`'s 200-newest window, and `deleteThread` addresses a
  thread directly by `threadId`, never through the list. No change to
  thread capacity was needed to fix the reply-specific gap the review
  found.

### Lifecycle/moderation
**Threads and replies now have different lifecycle shapes** — this is a
deliberate consequence of Owner Decision 2, not an inconsistency: a thread
has no position to preserve in any list once it's gone (deleting it removes
it from `listTeamThreads` entirely, BR-25), so nothing is gained by
keeping its document around; a reply's document is kept, content-erased,
specifically because its *position within its still-existing thread's
reply list* is worth preserving (BR-26).

**Thread**: exists, or does not. There is no derived status, no tombstone
field, and no soft-deleted state — `deleteThread` performs a genuine
Firestore document deletion (see "Server operations").

**Reply**: derived from one optional timestamp, exactly as in the original
design — but a `"deleted"` reply's document now has its content-bearing and
identity fields physically removed, not merely flagged:

```
isForumReplyDeleted(record) = record.deletedAt is set
```

| Reply state | Reached by | Who | Reversible? | Content in the document? |
|---|---|---|---|---|
| *(active)* | `createReply` | Any real team member (subject to the 500-reply cap, BR-52) | N/A (initial state) | Yes — `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` all present |
| *(tombstoned)* | `deleteReply` | The reply's own `authorUid` (checked before removal), or an app admin | No — no "restore" action exists anywhere (BR-30); and there is nothing to restore *from*, since the content is gone | **No** — `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` are all removed from the document itself (BR-26, BR-56); only `teamId`/`threadId`/`createdAt`/`deletedAt`/`deletedBy` remain |
| *(gone entirely)* | The reply's parent thread is hard-deleted via `deleteThread` | The thread's own `authorUid`, or an app admin | N/A — the document no longer exists | N/A — no document, active or tombstoned, remains |

**Why deleted content is never re-readable, unlike Challenges' `archived`
state.** Anonymous Challenges' `archived` state exists so a team's *active*
list stays clean while an admin retains a full historical view for
accountability — a deliberate design choice appropriate to a
management-lifecycle feature with an admin-only "everything" surface
already planned (`listTeamChallengesForAdmin`). This feature has no
equivalent admin-only surface (see "Product behavior" #7) and no
accountability need identified for v1 that would justify retaining
decryptable content after deletion; per Owner Decision 2, this feature goes
further than Anonymous Challenges here — not only is deleted content never
*served* to anyone, for a reply its ciphertext is actually erased from
storage, and for a thread the entire document (and its replies') is
removed, so there is no decryptable copy left anywhere for a future bug,
a compromised key, or a console operator to ever expose.

**Malformed vs. deleted — two different things, handled differently.** A
malformed *active-shaped* document (missing/invalid required content
field, undecryptable ciphertext) is **excluded** from a listing entirely
(a gap, as if it never existed) — this is data corruption, not a lifecycle
state (BR-20). A validly-tombstoned reply (BR-56: has `deletedAt`, and
*none* of the content/identity fields) is **retained as a visible
tombstone placeholder** at its original position (`isDeleted: true`, no
content) — this is an intended lifecycle outcome, not corruption. A
document that has *some but not all* of a tombstone's expected removed
fields (e.g. `deletedAt` is set but `ciphertext` is still present) is
itself treated as malformed and excluded, per BR-56 — this shape should
never occur if `deleteReply` is implemented correctly, and the validator
fails closed on it rather than guessing which shape was intended.

- **Reply-tombstone idempotency**: calling `deleteReply` again on an
  already-tombstoned reply is a no-op success (BR-27) — no error, no
  further field change — for **any authenticated caller**, not only the
  reply's original author or an app admin. A tombstone retains no
  `authorUid` (BR-26), so there is no persisted identity left to
  re-authorize a repeat call against; the operation checks tombstone state
  *before* authorization specifically so a retried or lost-response call
  is never met with a spurious `forbidden`, without ever reconstructing or
  reintroducing the erased identity to authorize it. This check still runs
  strictly after the operation's own `teamId`/`threadId` cross-check (BR-32,
  BR-35), so a wrong-team/wrong-thread tombstone continues to resolve to
  `not_found` and never becomes an existence oracle.
- **Thread hard-delete idempotency**: calling `deleteThread` again on a
  thread that no longer exists resolves to `not_found` — there is no
  distinct "already deleted" outcome to report, because a hard-deleted
  thread's document is indistinguishable from one that never existed. This
  is a deliberate, narrow change from the original design's "idempotent
  `{ok: true}}`" contract for threads specifically (replies keep that
  contract); see "Server operations" for why this is still safe (an
  already-deleted-and-now-`not_found` outcome is not an error to the
  caller — the desired end state, "this thread is gone," already holds).
- **Deletion authority does not require current team membership.** An
  author's own-content delete path checks only "does this content's
  `authorUid` equal my verified `uid`," never current real membership —
  a member who has since left the team can still delete their own past
  posts (see "Edge cases and concurrency").
- **Team-disable interaction**: deletion is never gated on the owning
  team's `active`/`disabled` status (BR-31), mirroring Anonymous
  Challenges' `resolveChallenge`/`archiveChallenge`/`deleteChallenge`
  exactly.

## Server operations
All server-only (`"server-only"` import, Firebase Admin SDK), one function
per operation with an injectable dependency seam for testing, following
`src/features/challenges/server/`'s established shape. **No operation in
this feature requires a Firestore transaction.** `createThread`,
`createReply`, and `deleteReply` remain single-document create/update
operations exactly as in the original design; `deleteThread` is now a
two-step sequential operation (not a transaction — see below for why a
transaction is neither required nor possible here), but still protects no
race-sensitive shared invariant beyond what idempotent retry already
covers.

- **`createThread(idToken, teamId, title, body, deps)`** — unchanged from
  the original design:
  - `verifyIdToken` → `sign_in_required` if absent/invalid.
  - Validate `title` (3–150 chars, trimmed) and `body` (3–4000 chars,
    trimmed) → `invalid_input` otherwise, nothing read/written yet.
  - Check a real `teamMemberships/{uid}__{teamId}` record exists (BR-1) →
    `forbidden` otherwise (an app admin with no such record included).
  - Re-read `teams/{teamId}.status` fresh → `team_disabled`/`team_not_found`
    if not `active` (BR-7).
  - Encrypt `JSON.stringify({title, body})` (fresh IV) → `.add()` to
    `forumThreads`: `{teamId, authorUid: caller.uid, ciphertext, iv,
    authTag, keyVersion, createdAt: now}`.
  - Return `{ok: true, threadId}`.
  - Fail-closed on any Firestore/encryption error → `encryption_failed` /
    `persistence_failed`, nothing partially persisted.

- **`createReply(idToken, teamId, threadId, body, deps)`** — one new step
  (the capacity check) added to the original design:
  - `verifyIdToken` → `sign_in_required`.
  - Validate `body` (3–2000 chars, trimmed) → `invalid_input`.
  - Check real `teamMemberships/{uid}__{teamId}` (BR-1) → `forbidden`.
  - Re-read `teams/{teamId}.status` fresh → `team_disabled`/`team_not_found`
    (BR-7).
  - Fetch the target `forumThreads/{threadId}`; missing or `teamId`
    mismatch → `not_found` (a thread can no longer be "malformed" in a way
    distinct from "missing," since it has no lifecycle field of its own to
    corrupt — see "Data model").
  - **New**: count the thread's current replies (`forumReplies.where(
    "threadId","==",threadId).count().get()`); `>= 500` → `thread_full`
    (BR-52), nothing written.
  - Encrypt `body` (fresh IV) → `.add()` to `forumReplies`: `{teamId:
    thread.teamId, threadId, authorUid: caller.uid, ciphertext, iv,
    authTag, keyVersion, createdAt: now}`.
  - Return `{ok: true}` — no id needed; the client re-fetches
    `getThreadWithReplies` afterward (authoritative refresh). Returning
    `replyId` was considered (as a way to guarantee future addressability)
    but is unnecessary now that BR-52's cap guarantees every reply is
    always within `getThreadWithReplies`'s fully-returned set — there is
    no gap left for a returned id to close.

- **`listTeamThreads(idToken, teamId, deps)`** — simplified from the
  original design (no more author-display resolution step, no more
  isDeleted check, since a listed thread is definitionally active — a
  deleted thread's document does not exist to be returned by the query at
  all):
  - `authorizeTeamAccess(identity, teamId)` → `"admin"`/`"member"`
    required; `"denied"` → `forbidden`; a `read_failed` from the check
    itself is never collapsed into `forbidden` (BR-15).
  - Query `forumThreads` where `teamId == teamId`, order by `createdAt`
    descending, limit 200 (BR-19, BR-34).
  - Per raw document: validate (fail-closed; skip a malformed document —
    BR-20) → decrypt `{title, body}` (skip on a decryption failure, same
    as a malformed document) → compute `authorTag` (pure function, TASK-001
    — BR-11) and `isOwnThread = authorUid === caller.uid` → map to
    `ThreadSummaryView`.
  - Returns `{ok: true, threads: ThreadSummaryView[]}` in the already-
    query-sorted (newest-first) order.

- **`getThreadWithReplies(idToken, teamId, threadId, deps)`** — simplified
  ordering (no more descending-query-then-reverse trick, now that every
  reply of a thread is always returned in full — see "Query/index model"):
  - Same `authorizeTeamAccess` boundary as `listTeamThreads` (BR-16).
  - Fetch `forumThreads/{threadId}`; missing or `teamId` mismatch →
    `not_found` (the identical outcome for both causes — BR-16).
  - Decrypt the thread's `{title, body}` → compute `authorTag`/
    `isOwnThread` exactly as in `listTeamThreads`.
  - Query `forumReplies` where `threadId == threadId`, order by `createdAt`
    ascending, `limit(500)` (a defensive safety cap — BR-52 already keeps
    real counts at or near 500; this limit only guards against BR-53's
    rare over-cap race ever producing a query result the operation isn't
    designed to handle).
  - Per raw reply document: cross-check its own `teamId` against the
    parent thread's `teamId` (BR-35) → classify its shape (fail-closed,
    TASK-001's `isValidForumReply`, BR-56): a well-formed *active* shape
    (all content fields present, no `deletedAt`) → decrypt, compute
    `authorTag`/`isOwnReply`, map to a full `ReplyView`; a well-formed
    *tombstone* shape (`deletedAt` present, all content/identity fields
    absent) → map to a tombstone `ReplyView` (`isDeleted: true`, no
    content, no `authorTag`) at its original position; any other shape
    (corruption — e.g. both present, or partially present) → excluded
    entirely, never fabricated, never crashes the call (BR-20, BR-56).
  - Returns `{ok: true, thread: ThreadDetailView, replies: ReplyView[]}` —
    this is now always the *complete* set of the thread's replies, never a
    truncated "most recent N of a larger set" (BR-19, revised).

- **`deleteThread(idToken, teamId, threadId, deps)`** — redesigned per
  Owner Decision 2 into a genuine hard delete with a bounded, looped
  reply-cascade:
  - `verifyIdToken` → `sign_in_required`.
  - Fetch the target `forumThreads/{threadId}`; missing or `teamId`
    mismatch → `not_found` (mirrors the read-path's uniform-`not_found`
    posture — a non-owner, non-admin caller must not learn a thread exists
    in another team merely by probing a delete call either; and, per the
    revised idempotency contract, a *previously*-deleted `threadId` is
    indistinguishable from one that never existed, and also resolves to
    `not_found` — see "Lifecycle/moderation").
  - Authorization: `isAppAdmin(identity)` **or** `thread.authorUid ===
    identity.uid` → otherwise `forbidden`. (Does **not** re-verify current
    real team membership for the author path — see "Lifecycle/moderation"
    and "Edge cases.")
  - **Step 1 — delete the thread document itself first** (`.delete()`),
    *before* touching its replies (BR-55 — this ordering, not the reverse,
    is what minimizes the orphan-reply race window described in "Edge
    cases and concurrency").
  - **Step 2 — cascade-delete its replies**: repeatedly query up to 500
    reply documents for this `threadId` (`.limit(500)`, no ordering
    needed) and delete them in one Firestore `WriteBatch` per iteration
    (each batch safely within Firestore's per-batch write-count limit),
    looping until a query returns zero results (BR-54) — correct
    regardless of whether BR-53's rare race ever pushed a thread's actual
    reply count above its nominal 500 cap.
  - Returns `{ok: true}` once both steps complete. **Not a Firestore
    transaction**: a transaction reading and rewriting up to 500+1
    documents would itself risk exceeding Firestore's per-transaction
    operation limits, exactly the constraint BR-54's looped-batch design
    is built to respect — this is a plain sequential two-step operation.
    **Retrying `deleteThread` is a safety net only *before* step 1 (the
    thread delete) has committed** — a retry from scratch in that window
    correctly re-runs both steps against a thread that still exists. It is
    **not** a safety net once step 1 has already committed and a later
    failure or crash interrupts step 2: at that point the thread document
    is already gone, so a retried `deleteThread(threadId)` call's own
    fetch step finds nothing and immediately returns `not_found` — it does
    not resume, complete, or otherwise repair the interrupted cascade. Any
    replies not yet deleted at that point remain orphaned, encrypted, and
    permanently unreachable through any operation this feature exposes
    (see "Edge cases and concurrency" and "Accepted residual risks" #9).
    This is an explicitly accepted residual risk for v1, not a guarantee
    this operation provides — closing it would require a separate cleanup
    mechanism, not introduced here.
  - Fail-closed on any Firestore error during either step →
    `persistence_failed`.

- **`deleteReply(idToken, teamId, threadId, replyId, deps)`** — redesigned
  per Owner Decision 2 into a content-erasing tombstone:
  - Fetch `forumReplies/{replyId}`, additionally cross-checking
    `reply.threadId === threadId` (route scope) alongside
    `reply.teamId === teamId` — missing, malformed, or a mismatch on either
    is `not_found` (BR-32, BR-35). This cross-check runs *before* the
    tombstone check below, so a wrong-team/wrong-thread tombstoned reply
    stays indistinguishable from one that never existed — never an
    existence oracle.
  - **Already tombstoned** (no `ciphertext` field present) → idempotent
    `{ok: true}` for **any authenticated caller**, no write, no further
    authorization check at all (BR-27, revised) — a tombstone retains no
    `authorUid`, so there is nothing left to re-authorize a repeat call
    against, and nothing is reconstructed to perform one; unlike
    `deleteThread`, this operation's document still exists to check, so it
    keeps the original idempotent-success contract rather than falling
    back to `not_found`.
  - Otherwise (still active): authorization is `isAppAdmin(identity)` or
    `reply.authorUid === identity.uid`, else `forbidden` — then a single
    `update()` that sets `deletedAt: now` and `deletedBy: caller.uid`, and
    removes `ciphertext`, `iv`, `authTag`, `keyVersion`, and `authorUid`
    via Firestore `FieldValue.delete()` on each — one atomic document
    write, not a transaction (a single document's own fields are always
    updated atomically by Firestore).

Error contracts follow this codebase's existing convention: a discriminated
result type distinguishing a genuine authorization/validation outcome from
`{ok: false, error: "read_failed" | "persistence_failed"}` for an
infrastructure failure.

### Why `not_found`, not `wrong_team`, at every boundary in this feature
Anonymous Challenges' admin-only management operations return a distinct
`wrong_team` for a cross-team `challengeId`, since only an app admin ever
calls them and existence-leakage to an app admin (who already administers
`teamId`s directly) isn't a meaningful concern. This feature's delete
operations are callable by an ordinary member (the content's own author),
not only an app admin, so this spec deliberately folds every cross-team/
non-existent/deleted case into the same generic `not_found` everywhere —
consistent with `docs/UI-UX.md`'s "authorization failure ... never a state
that leaks *why* or *whether* a resource exists" principle, applied here to
member-facing operations, not only to genuinely public-facing ones.

## API/DTO contract
Routes are thin delegates (`.claude/rules/nextjs-react.md`), each reading
only the exact whitelisted body field(s) named below — no other request
field is ever passed through to a server operation (BR-2, BR-47):

| Route | Method | Delegates to | Request body | Auth error mapping |
|---|---|---|---|---|
| `/api/teams/[teamId]/forum/threads` | GET | `listTeamThreads` | — | `unauthenticated`→401, `forbidden`→403, else→500 |
| `/api/teams/[teamId]/forum/threads` | POST | `createThread` | `{title, body}` only | `sign_in_required`→401, `invalid_input`→400, `forbidden`→403, `team_not_found`→404, `team_disabled`→400, `encryption_failed`/`persistence_failed`→500 |
| `/api/teams/[teamId]/forum/threads/[threadId]` | GET | `getThreadWithReplies` | — | `unauthenticated`→401, `forbidden`→403, `not_found`→404, else→500 |
| `/api/teams/[teamId]/forum/threads/[threadId]` | DELETE | `deleteThread` | — | `sign_in_required`→401, `not_found`→404, `forbidden`→403, else→500 |
| `/api/teams/[teamId]/forum/threads/[threadId]/replies` | POST | `createReply` | `{body}` only | `sign_in_required`→401, `invalid_input`→400, `forbidden`→403, `not_found`→404, `team_disabled`→400, `thread_full`→400, `encryption_failed`/`persistence_failed`→500 |
| `/api/teams/[teamId]/forum/threads/[threadId]/replies/[replyId]` | DELETE | `deleteReply` | — | `sign_in_required`→401, `not_found`→404, `forbidden`→403, else→500 |

Response DTOs (client-facing; the gateway rebuilds each item from only
these fields, mirroring `challenges-gateway.ts`'s established
"rebuild, don't merely pass through" discipline). **Revised**: `authorTag`
(non-nullable string) replaces the original `authorDisplay: string | null`
throughout — see "Identity/attribution model."

```ts
type ThreadSummaryView = {
  threadId: string;
  title: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string; // ISO timestamp — full precision (see below)
};

type ThreadDetailView = {
  threadId: string;
  title: string;
  body: string;
  authorTag: string;
  isOwnThread: boolean;
  createdAt: string;
};

type ReplyView =
  | {
      replyId: string;
      isDeleted: false;
      body: string;
      authorTag: string;
      isOwnReply: boolean;
      createdAt: string;
    }
  | {
      replyId: string;
      isDeleted: true;
      body: null;
      authorTag: null;
      isOwnReply: false;
      createdAt: string;
    };
```

**No time-of-day minimization, unlike Anonymous Challenges.** Challenges
truncates `submittedAt` to a date-only string specifically to reduce
correlation risk against an *anonymous* submitter (`docs/features/
anonymous-challenges/SPEC.md` BR-12). That rationale doesn't apply here —
authorship continuity is already shown via `authorTag` — so a full ISO
timestamp is returned and may be rendered as an ordinary "posted 2 hours
ago"-style relative time client-side, consistent with `docs/UI-UX.md`'s
existing convention for a secondary, non-load-bearing relative label.

Never included in any response, under any circumstance: `authorUid`,
`deletedAt`, `deletedBy`, `ciphertext`/`iv`/`authTag`/`keyVersion`, any
email address, `teamId` on a reply (redundant with the route scope the
client already knows).

## UI/UX
- **`/teams/[teamId]`** gains a "Forum" section, visible to an authorized
  member/admin (the existing non-member "request access" state is
  unaffected and unchanged):
  - A thread list (title, `authorTag`, relative/absolute date), newest-
    first, fetched via `listTeamThreads` — loading, empty ("ingen tråder
    ennå" / no threads yet), and infrastructure-failure states.
  - A "start a new thread" action, visible only to a real team member
    (never a non-member, never an app-admin-without-membership) — a
    labeled title field and body textarea, with client-side length hints
    mirroring BR-3's bounds as a UX aid only (the server call remains
    independently authoritative, per the established "client bounds are
    not a security control" precedent).
  - Disabled team: the "start a new thread" action is hidden/disabled
    (mirrors the existing survey-creation and challenge-submission
    restriction); the existing thread list remains visible (BR-21).
- **A thread detail view** (new route, e.g. `/teams/[teamId]/forum/
  [threadId]`, or a client-side detail panel — an implementation-task
  decision, not a product-behavior one): title, body, `authorTag`, replies
  in chronological order (each rendered per `ReplyView`'s `isDeleted`
  variant — a tombstoned reply renders a fixed, non-identifying "Innlegget
  er fjernet" placeholder, never omitted from the list), and a reply
  submission panel for a real team member — disabled with a clear message
  once the thread has reached its 500-reply capacity (`thread_full`,
  BR-52).
  - A `not_found` result (cross-team, deleted, or never-existed thread)
    renders the same generic "not found"/non-sensitive state for every
    cause (BR-16) — never a distinguishing message.
- **Delete affordances**: a thread's own author or an app admin sees a
  delete action on that thread (redirecting back to the thread list on
  success, since the thread is now genuinely gone); a reply's own author
  or an app admin sees a delete action on that reply. Neither affordance
  appears for anyone else. Delete requires an explicit confirmation step
  before it executes — for a thread, the confirmation copy states plainly
  that this also permanently removes every reply, since (per Owner
  Decision 2) that is now literally true, not merely a visibility
  consequence.
- **Failure isolation**: the forum section's fetch/mutation state is
  independent of the team page's existing results/current-survey/
  challenges sections — a forum read/write failure never hides or corrupts
  those sections' own state, and vice versa (mirrors the existing
  `ChallengesSectionState`-style independent-section pattern already
  established in `TeamDetail`).
- **Stale-generation protection**: a create-thread/create-reply/delete
  response that resolves after the caller has signed out, or after
  navigation to a different `teamId`/thread, is discarded rather than
  applied to a now-stale view — mirrors `TeamDetail.handleChallengeSubmitted`'s
  existing `isCurrentGeneration` guard exactly.
- **Content rendering (BR-22)**: thread/reply text is rendered strictly as
  literal text — via ordinary JSX text interpolation (`{body}`), never
  `dangerouslySetInnerHTML`, never passed through a Markdown/HTML parser,
  and never used to construct an element via string concatenation. Text
  that happens to look like HTML/script (e.g. `<script>alert(1)</script>`
  typed into a reply) must render as inert, visible literal characters —
  verified by a runtime test, not only a source-code absence check for the
  dangerous API (see "Testing strategy").
- Internal/technical values (`isDeleted`, raw ISO timestamps) are never
  shown directly — every surface uses Norwegian labels and relative/
  localized dates, sourced from a feature copy module
  (`src/features/forum/copy.ts`, following the established convention).
  The copy module is also solely responsible for any prefix/framing text
  around `authorTag` (e.g. rendering it as "Medlem {authorTag}") — the
  server returns the bare tag string only, never pre-formatted UI text.
- Reuses existing shared primitives (`Button`, `Card`, `Alert`,
  `EmptyState`, `LoadingState`, `PageHeader`) and the shared
  `useAuthGatedResource` hook — no new component system.
- Accessibility: the title field and body textarea each have a real
  associated `<label>`; every action (create thread, reply, delete) is
  keyboard-operable with a visible focus state; a tombstoned reply is
  conveyed by text, not color/icon alone.
- Responsive: works at common phone widths, consistent with every other
  screen in this application.
- No reaction, voting, categorization/tag, mention, notification, search,
  pinning, locking, or AI-classification feature exists anywhere in this
  UI (Non-goals).

## Firestore/index implications
- New collections: `forumThreads/{threadId}`, `forumReplies/{replyId}` —
  see "Data model" for exact shape. **Not created in this planning
  session** — `firestore.rules`/`firestore.indexes.json` are unmodified;
  the additions below are specified for an implementation task to apply.
- `firestore.rules`: add, before the final catch-all deny, identical in
  form to every existing collection's block:
  ```
  match /forumThreads/{document=**} {
    allow read, write: if false;
  }
  match /forumReplies/{document=**} {
    allow read, write: if false;
  }
  ```
- `firestore.indexes.json`: **two new composite indexes** (query direction
  revised from the original planning pass — replies now query ascending
  directly, since every reply of a thread is always returned in full, with
  no more "fetch the most recent N descending, then reverse" step needed):
  1. `forumThreads`: `teamId` ascending, `createdAt` descending — serves
     `listTeamThreads`'s `where("teamId","==",teamId).orderBy("createdAt",
     "desc").limit(200)`.
  2. `forumReplies`: `threadId` ascending, `createdAt` ascending — serves
     `getThreadWithReplies`'s `where("threadId","==",threadId).orderBy(
     "createdAt","asc").limit(500)`.
  Without these deployed, both operations fail closed with a read-failure
  response against a real Firestore project (same consequence already
  documented for `docs/DEVELOPMENT.md`'s existing `teamInvitations`/
  `teamAccessRequests` composite indexes).
  - **No composite index for the reply-cap count query (BR-52)**: a
    `.count()` aggregation over `where("threadId","==",threadId)` alone
    (no `orderBy`) needs only the automatic single-field index Firestore
    already maintains — confirmed against the actual query shape, not
    assumed.
  - **No composite index for `deleteThread`'s cascade query**: `where(
    "threadId","==",threadId).limit(500)` (no `orderBy` — deletion order
    doesn't matter) likewise needs only the automatic single-field index.
- No coordination document, and (per Owner Decision 2) no counter document
  either — no "at most one" or "exactly N" invariant is protected by a
  denormalized field anywhere in this feature.
- Cross-team defensive filtering: every returned document's own `teamId`
  is validated against the caller's authorized route scope, independent of
  the query's own scoping (BR-18, BR-35) — the query narrows what's
  fetched; validation is what's actually trusted.
- Malformed-record policy: an active-shaped document that fails validation
  is excluded from a list entirely; for replies specifically, a document
  matching neither the valid-active nor the valid-tombstone shape (BR-56)
  is likewise excluded, never guessed at or partially trusted.
- **No unnecessary index introduces a new discovery pattern**: neither
  composite index, nor the two count/cascade queries, filters or sorts on
  any content field — only on `teamId`/`threadId`/`createdAt`, exactly as
  in the original design.

## Edge cases and concurrency
- Two members reply to the same thread concurrently, both below the
  500-reply cap → both succeed independently; ordering is resolved purely
  by each document's own server-assigned `createdAt`.
- Two members reply to the same thread concurrently when it is at exactly
  499 replies → both may pass the count check and both succeed, leaving
  the thread at 501 replies — an accepted, extremely narrow residual race
  (BR-53), not a correctness problem for anything else in this feature
  (BR-54's cascade-delete loop handles any actual reply count correctly
  regardless).
- An author deletes their thread while another member is mid-composing a
  reply to it → because `deleteThread` deletes the thread document first
  (BR-55), a `createReply` call that reaches its "fetch the thread" step
  after that point is rejected `not_found`, exactly as if the thread had
  never existed. A `createReply` call whose own `.add()` write happens to
  land in the narrow window between `deleteThread`'s step 1 (thread
  deleted) and step 2's reply-cascade query snapshot is still caught by
  that same query and deleted along with the rest. The only remaining,
  narrower race is a `createReply` write landing *after* step 2's last
  query snapshot but *before* `deleteThread` returns — in this rare case, a
  single orphaned reply document could persist, still encrypted, with no
  parent thread. This residual is accepted as benign: no read path in this
  feature ever queries `forumReplies` without first successfully fetching
  the parent thread (BR-16), so an orphaned reply is structurally
  unreachable through any documented operation — a storage-hygiene
  residual, not a confidentiality or correctness one.
- The author and an app admin both call `deleteReply` on the same reply at
  nearly the same moment → both succeed; the second call observes the
  tombstone already present and returns the identical idempotent success
  (BR-27) — no error surfaces to either caller, and `deletedBy` simply
  reflects whichever write physically committed first (an internal-only
  field, never exposed — BR-28, mirrors Anonymous Challenges' identical
  accepted imprecision for `resolvedBy`/`archivedBy` under concurrent admin
  actions). This holds identically for *any* later authenticated caller
  retrying the same already-tombstoned reply, not only the two actors
  named here — BR-27's idempotent success is unconditional on caller
  identity once a correctly-scoped tombstone exists (see "Lifecycle/
  moderation" → "Reply-tombstone idempotency").
- The author and an app admin both call `deleteThread` on the same thread
  at nearly the same moment → the first call's step 1 succeeds; the
  second call's fetch finds no document and returns `not_found` — an
  acceptable outcome to surface to the second caller (the thread they
  wanted gone is, in fact, gone), unlike the reply case, which still has a
  document to report idempotent success against.
- A team is disabled while a member has the create-thread/create-reply
  form open → the form's earlier render is unaffected; the next submit
  attempt is rejected fresh against the team's current status (BR-7).
- A member is removed from the team after posting several threads/replies
  → their existing content remains, fully attributed (by tag), unchanged
  (BR-14). They can no longer create new content for that team (BR-1
  requires *current* real membership), but they can still delete their own
  past content afterward — deletion's author-ownership check compares
  only `authorUid` to the verified caller's `uid`, and deliberately does
  not re-require current team membership (see "Lifecycle/moderation").
  This is an intentional, minor asymmetry (you can always delete your own
  words, even after leaving; you cannot post new ones once you've left),
  recorded here rather than left as an implicit accident.
- An author's Firebase account itself is deleted (distinct from team
  membership removal) → their content, and their `authorTag`, are entirely
  unaffected — the tag never depended on the account existing (see
  "Identity/attribution model" — this is a strictly simpler outcome than
  the original email-based design's degradation case).
- A malformed persisted thread/reply is present in Firestore (e.g. from a
  future bug or a manual console edit that should not have happened) →
  excluded from `listTeamThreads`/`getThreadWithReplies`'s reply list
  without failing the call, unless the *thread itself* is malformed, in
  which case the whole `getThreadWithReplies` call fails closed
  (`read_failed`) rather than fabricating thread content from an
  untrustworthy record (BR-20). A reply document that is neither validly
  active nor validly tombstoned (BR-56) is excluded the same way.
- A create-thread/create-reply encryption call throws (e.g. missing
  `ENCRYPTION_KEY`) → the call fails closed with a generic infrastructure-
  failure response; nothing is persisted; the thrown error is never logged
  verbatim (BR-36).
- A `deleteThread` call crashes (process restart, network partition)
  between step 1 (thread deleted) and step 2 (reply cascade) completing →
  the thread document is gone, some or all of its replies may remain. A
  subsequent `deleteThread(threadId)` call on the same id now finds no
  thread document and returns `not_found` (per the revised idempotency
  contract) — **this does not clean up the orphaned replies**, since
  `deleteThread`'s fetch-thread step is what triggers the cascade, and
  there is no longer a thread to fetch. This is a recorded, accepted
  operational gap in v1 (see "Accepted residual risks") rather than a
  silently-introduced one: recovering from this specific crash window
  would require a maintenance operation outside this feature's v1 surface
  (e.g. a manually-triggered cleanup of orphaned `forumReplies` documents
  whose `threadId` no longer resolves) — not built for v1, since the
  window is narrow (a crash between two immediately sequential Firestore
  calls) and its consequence is encrypted, unreachable, storage-only, not
  a confidentiality or correctness defect.

## Accepted residual risks
1. A tag collision (two authors in one team sharing an `authorTag`) is an
   extremely low-probability, non-identity-revealing display ambiguity
   (C) — see "Identity/attribution model" → "Collision expectations."
2. No rate limiting for thread/reply creation — bounded only by requiring
   real, authenticated team membership (C), mirrors Anonymous Challenges.
3. `listTeamThreads`'s 200-row bound means a very high-volume team's oldest
   threads become invisible via that listing operation without further
   (pagination) work — but remain individually addressable/deletable by a
   caller who already has the `threadId` (e.g. from a bookmarked detail-
   page URL), so this is a visibility limit, not an addressability one (C)
   — an explicit, intentional bound (see "Non-goals" → "True pagination").
   Unlike the original planning pass, there is no equivalent residual risk
   for replies: BR-52's creation-time cap guarantees every reply of a
   thread is always returned in full by `getThreadWithReplies`.
4. The 500-reply cap is enforced best-effort (BR-53), not transactionally —
   a rare concurrent-creation race could push a thread slightly over its
   nominal cap. `deleteThread`'s cascade (BR-54) is explicitly designed to
   remain correct regardless.
5. Free text may contain identifying or sensitive information about the
   author or a named colleague; mitigated only by UI copy, with no
   automated scanning in v1 (C/D).
6. No admin-visible record of deleted content exists for legitimate
   moderation-review purposes — once deleted, content no longer exists
   anywhere to be read, for anyone (C) — see "Lifecycle/moderation" for
   why this is the deliberately smaller v1.
7. An ex-member can still delete (but never read anew, create, or restore)
   their own historical posts after leaving a team (C) — a minor,
   intentional asymmetry, not an oversight (see "Edge cases").
8. Concurrent `deleteReply` calls from two different actors on the same
   reply can attribute `deletedBy` to whichever write physically lands
   last, since no transaction serializes these single-document updates
   (C) — this field is never exposed by any API response (BR-28), so the
   only consequence is a possible future accuracy question for an operator
   with direct Firestore access, never a correctness-of-visibility
   regression (mirrors Anonymous Challenges' identical accepted risk for
   `resolvedBy`/`archivedBy`).
9. A process crash between `deleteThread`'s two steps can leave orphaned,
   encrypted, permanently unreachable reply documents with no cleanup path
   in v1 (C/B — see "Edge cases and concurrency"). Not a confidentiality or
   correctness defect (the orphan is structurally unreadable through any
   operation this feature exposes), but a storage-hygiene gap that a
   future maintenance/cleanup task could address if it proves material in
   practice.

## Testing strategy
| Boundary | Covers |
|---|---|
| Domain validators (`validateThreadTitle`, `validateThreadBody`, `validateReplyBody`, `isValidForumThread`, `isValidForumReply` — both active and tombstone shapes, `isForumReplyDeleted` derivation, `authorTag`) | BR-3, BR-4, BR-20, BR-50, BR-51, BR-56 — including: `authorTag` determinism (same `(teamId, authorUid)` → same tag, across repeated calls); different `teamId` for the same `authorUid` → different tag; the function performs no I/O (a fake/throwing Firestore or Firebase Auth dependency is never invoked); `isValidForumReply` accepts a well-formed active shape and a well-formed tombstone shape, and rejects a shape with fields from both or neither |
| `createThread`/`createReply` server tests | BR-1, BR-2, BR-5, BR-6, BR-7, BR-8, BR-9, BR-47, BR-52, BR-53 — including: real-member success; app-admin-without-membership rejection; disabled-team rejection; malformed/oversized/empty title/body rejection; a reply on a deleted (i.e. now-nonexistent) thread rejected `not_found`; a reply on a cross-team thread rejected `not_found`; a reply on a thread already at 500 replies rejected `thread_full`, with zero writes; encryption-failure fail-closed; a request body carrying `authorUid`/`teamId`/`threadId`/`deletedAt` overrides is proven to have no effect; repeated creations from the same identity all succeed independently |
| `listTeamThreads` server tests | BR-15, BR-18, BR-19, BR-20, BR-21, BR-34 — including: member and admin success; non-member/non-admin rejection; cross-team exclusion; a hard-deleted thread never appears (proven by seeding, then deleting via the actual `deleteThread` operation, then asserting the list no longer contains it — not merely that a soft-delete flag is respected); disabled-team viewing continuity; malformed-thread exclusion without failing the call; the 200-row bound exercised with more than 200 seeded threads, asserting only the 200 newest are returned; returned DTO never contains `authorUid`/encrypted fields/any email-shaped value |
| `getThreadWithReplies` server tests | BR-16, BR-17, BR-18, BR-19, BR-20, BR-26, BR-34, BR-35, BR-52, BR-56 — including: success returning thread + every reply in oldest-first order; a cross-team, a never-existed, and a hard-deleted `threadId` all resolve to the byte-identical `not_found` (asserted via full response-shape equality); a malformed reply excluded while a malformed thread fails the whole call closed; a corrupted reply document whose own `teamId` doesn't match its parent thread's `teamId` is excluded (BR-35); **critical regression test**: a reply is deleted via the actual `deleteReply` operation (not a hand-seeded fixture) and the full serialized response is asserted to still include that `replyId` at its original position but to contain neither its original plaintext nor any author-identifying value, and a `decrypt` spy proves it was never invoked with that record (see decrypt-spy row below); a thread seeded at exactly 500 replies returns all 500, in ascending order, with no truncation |
| **Decrypt-before-filter protection tests** (new — closes a gap the planning review found: the original test plan proved deleted/excluded content never appears in a *response*, but not that it is never *decrypted* at all) | BR-15, BR-20, BR-26 — a `decrypt` spy (wrapping the real `src/lib/encryption/encryption.ts` export) proves: (a) a tombstoned reply's absence of a `ciphertext` field means `decrypt` cannot be and is not called for it at all (there is nothing to pass to it); (b) a malformed/undecryptable record excluded from a list is never retried or logged with its ciphertext; (c) `deleteThread`/`deleteReply` never call `decrypt` on any path — a dedicated module-surface/spy test per operation, mirroring `docs/features/anonymous-challenges/TASKS.md` TASK-004's "no operation calls decrypt" assertion |
| `deleteThread` server tests | BR-23, BR-24, BR-25, BR-30, BR-31, BR-32, BR-54, BR-55 — including: author-of-own-thread success; app-admin success on someone else's thread; a plain member who is neither the author nor an admin is rejected (zero writes); a `threadId` belonging to another team is rejected `not_found` (zero writes); a second `deleteThread` call on an already-deleted thread returns `not_found` (not idempotent `{ok:true}` — the revised contract); the thread document is actually absent from Firestore afterward (`.get().exists === false`), not merely flagged; every one of its replies is actually absent from Firestore afterward too — seeded with more than 500 replies (simulating BR-53's rare over-cap race) to prove the looped-batch cascade (BR-54) removes all of them, not just the first 500; deletion succeeds against a disabled team's content with zero `teams` reads; no "restore" export exists anywhere |
| `deleteReply` server tests | BR-23, BR-26, BR-27, BR-28, BR-30, BR-31, BR-32, BR-56 — including: author-of-own-reply success; app-admin success on someone else's reply; a plain member who is neither the author nor an admin is rejected (zero writes); a `replyId`/`threadId` mismatch (wrong team or wrong thread) is rejected `not_found`; idempotent no-op on an already-tombstoned reply for any authenticated caller (the original author, a different non-admin member, or an app admin), with zero additional writes in every case, and a wrong-team/wrong-thread tombstone still resolving to `not_found` rather than an idempotent success; the persisted document after deletion is asserted via `Object.keys` to contain **exactly** `{teamId, threadId, createdAt, deletedAt, deletedBy}` — no `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` present, not merely absent from a DTO; deletion succeeds against a disabled team's content with zero `teams` reads; no "restore"/"unarchive"-shaped export exists |
| Firestore rules/config assertions | BR-33, BR-34 — a static assertion (mirroring `firestore-deployment-config.test.ts`'s existing pattern) that both new collections carry the deny-all block; an assertion that exactly the two documented composite indexes exist for this feature, matching the actual query shapes used (`teamId`+`createdAt desc` for threads, `threadId`+`createdAt asc` for replies) |
| Logging assertions | BR-36 — spy on console/logging output across every success and failure path in every operation above, asserting no thread/reply plaintext or ciphertext ever appears |
| API route tests | Thin route handlers delegating to the server operations above; each route's request-body whitelisting is proven directly — a request injecting `authorUid`/`teamId`/`deletedAt`/`threadId`/`status`-shaped fields alongside the legitimate field(s) results in only the legitimate field(s) reaching the server operation (BR-2, BR-47); `thread_full` maps to 400 |
| Gateway (client fetch wrapper) shape-validation tests | Mirrors `challenges-gateway.ts`'s established pattern — malformed/unexpected server response shapes are rejected client-side rather than rendered as if valid; an item carrying extra `authorUid`/`ciphertext`/`deletedBy`/email-shaped fields has those fields stripped by the DTO rebuild, never merely ignored by a type-only guard |
| **Runtime stored-XSS rendering test** (new — closes a gap the planning review found: the original test plan verified only the *absence* of a dangerous API from source, not *safe rendering behavior* at runtime) | BR-22 — a component test creates a thread/reply whose body is an HTML/script-shaped string (e.g. `<img src=x onerror=alert(1)>`, `<script>window.__xss=true</script>`) and asserts, against the actual rendered DOM: (a) the literal characters (including `<`/`>`) are present as visible text content, (b) no corresponding DOM element (`<img>`, `<script>`) was created, (c) no injected script side-effect occurred (e.g. `window.__xss` is not set) |
| Component tests | Thread list (loading/empty/loaded/error, newest-first order), create-thread form (validation/loading/success/error, focus moves to the new thread or a success confirmation), thread detail (loading/empty-replies/loaded/error, a tombstoned reply rendering the fixed placeholder text, never the original content, and a disabled reply form once `thread_full` is returned), reply form (same interaction-state matrix as create-thread), delete action (confirmation step required before it executes — thread-delete confirmation copy explicitly mentions replies are also removed; visible only to the content's own author or an app admin — a defense-in-depth test asserting the delete affordance is absent from the rendered output for a non-owner/non-admin) |
| Stale-generation regression tests | BR-46 — mirrors `TeamDetail`'s existing challenge-submission-refresh regression tests: a create-thread/create-reply/delete response that resolves after sign-out, or after navigating to a different `teamId`/thread, is discarded rather than applied to the now-stale view |
| Privacy regression tests | A dedicated test asserting the full serialized shape of every response type in this feature (thread summary, thread detail, reply, create/delete results) never contains `authorUid`, `deletedBy`, an encrypted field, or any value matching an email-address pattern, run against the actual TypeScript DTO types, not just spot-checked example values |

## Behavioral requirements

**Creation / content validation**
- **BR-1**: A caller can create a thread or reply for `teamId` only if
  their verified identity holds an actual `teamMemberships/{uid}__{teamId}`
  record — app-admin status alone is never sufficient.
- **BR-2**: `createThread`/`createReply` never accept a client-supplied
  `threadId`/`replyId`, `teamId` override, `authorUid`, `authorTag`,
  `createdAt`, `deletedAt`, or `deletedBy` — `teamId` is always the
  caller's trusted route scope; `authorUid` is always the verified caller's
  own `uid`.
- **BR-3**: A thread's title must be non-empty after trimming and between 3
  and 150 characters; its body must be non-empty after trimming and
  between 3 and 4000 characters. Any other input is rejected with nothing
  persisted.
- **BR-4**: A reply's body must be non-empty after trimming and between 3
  and 2000 characters. Any other input is rejected with nothing persisted.
- **BR-5**: On acceptance, thread/reply content is encrypted server-side
  (AES-256-GCM, fresh IV, reusing `src/lib/encryption/encryption.ts`
  unchanged) before being written.
- **BR-6**: `threadId`/`replyId` are Firestore auto-generated, opaque
  document IDs — never derived from `uid`, `teamId`, or content.
- **BR-7**: Creating a thread or reply for a `disabled` (or nonexistent, or
  status-malformed) team is rejected, re-checked fresh at creation time.
- **BR-8**: Creating a reply on a thread that has been deleted (and
  therefore no longer exists), or that belongs to a different team than
  the route scope, is rejected `not_found` — never silently attached to
  the wrong or a removed thread.
- **BR-9**: No duplicate-submission detection or rate limiting exists for
  thread/reply creation — the same identity may create any number of
  threads/replies (subject to BR-52's per-thread reply cap), and all
  succeed independently.

**Attribution**
- **BR-10**: Every persisted, *active* thread/reply stores exactly one
  identity field, `authorUid` — no email, display name, or other
  identity-shaped field is ever persisted alongside content. A tombstoned
  reply (BR-26) retains no identity field at all.
- **BR-11**: A thread/reply's author is displayed to an authorized reader
  as `authorTag` — a deterministic, pseudonymous, non-contact-reachable
  label computed purely from `(teamId, authorUid)` (see "Identity/
  attribution model" → "Author tag derivation") — never a value derived
  from Firebase Auth, email, or any other identity-lookup I/O, and never
  persisted or cached.
- **BR-12**: `authorTag` is unaffected by the author's Firebase account
  being deleted or disabled, their email changing, or their team
  membership being later removed — a thread/reply's displayed attribution
  never changes or degrades after the fact for any of these reasons
  (contrast with the retired live-email-lookup design, which required an
  explicit degradation case this design eliminates entirely).
- **BR-13**: A thread/reply's raw `authorUid` is never included in any API
  response — a reader instead receives only `authorTag` and a boolean
  `isOwnThread`/`isOwnReply` flag, computed server-side.
- **BR-14**: Team membership removal does not retroactively hide, delete,
  reassign, or re-label a member's existing threads/replies.

**Reading**
- **BR-15**: `listTeamThreads(teamId)` requires `authorizeTeamAccess` to
  resolve to `"admin"` or `"member"` for that `teamId`; `"denied"` is
  rejected; a `read_failed` from the check itself is never collapsed into
  `forbidden`. It returns every thread for that team that has not been
  deleted (deleted threads no longer exist, so none are ever returned),
  newest-first.
- **BR-16**: `getThreadWithReplies(teamId, threadId)` requires the same
  `authorizeTeamAccess` boundary as BR-15. A `threadId` that does not
  exist (whether never-created or already deleted) or belongs to a
  different team than the route scope resolves to the identical
  `not_found` outcome, in every case.
- **BR-17**: `getThreadWithReplies` returns replies oldest-first — the
  opposite ordering from the thread list (BR-15), which is newest-first.
- **BR-18**: A caller authorized for Team A cannot receive Team B's
  threads or replies from any read operation merely by supplying Team B's
  `teamId`/`threadId`.
- **BR-19**: `listTeamThreads` returns at most the 200 most recently
  created threads for a team — an explicit visibility bound, not full
  pagination, but not an addressability bound either (an older thread
  remains individually reachable/deletable by a caller who already knows
  its `threadId`). `getThreadWithReplies` returns **every** reply of a
  thread, in oldest-first order — always the complete set, never a
  truncated window, because BR-52 caps a thread's reply count at creation
  time.
- **BR-20**: A malformed persisted thread document, or one whose
  ciphertext fails to decrypt, causes the whole `getThreadWithReplies`
  call to fail closed (`read_failed`) or is excluded from
  `listTeamThreads`'s list (never fabricated, never crashes the call). A
  reply document matching neither a valid active shape nor a valid
  tombstone shape (BR-56) is excluded from the reply list without failing
  the whole call.
- **BR-21**: Viewing a disabled team's existing threads/replies remains
  available to that team's existing members/admins, unaffected by the
  team's `disabled` status.

**Content safety**
- **BR-22**: Thread/reply content is rendered strictly as plain text on
  every surface — never interpreted as HTML/Markdown and never rendered
  via `dangerouslySetInnerHTML` or an equivalent unsafe-HTML mechanism.
  Verified by a runtime test proving HTML/script-shaped input renders as
  inert literal text, not merely by the dangerous API's absence from
  source (see "Testing strategy").

**Moderation / deletion**
- **BR-23**: A thread or reply may be deleted only by its own `authorUid`
  or by an app admin — never by any other caller, even a fellow team
  member. This governs the transition *into* a deleted/tombstoned state
  specifically; a repeat call against a reply already in that state is
  governed separately by BR-27, which is unconditional on caller identity.
- **BR-24**: Deleting a thread is a genuine Firestore document deletion of
  the thread itself, followed by a genuine Firestore document deletion of
  every one of its replies — not an update that sets a deletion flag, and
  not an operation that leaves any of these documents intact-but-hidden.
  Deleting a reply outside a thread cascade is a content-erasing tombstone
  (BR-26), not a hard deletion of that reply's document.
- **BR-25**: Deleting a thread makes the entire thread — and every one of
  its replies — permanently non-existent as Firestore documents, not
  merely unavailable behind a read-side filter: after `deleteThread`
  completes, no document for that thread or any of its (pre-deletion)
  replies remains, for any caller, including an app admin with direct
  Admin SDK/console access (subject to the narrow crash-window residual in
  "Accepted residual risks" #9).
- **BR-26**: Deleting a single reply (not as part of a thread cascade)
  removes `ciphertext`, `iv`, `authTag`, `keyVersion`, and `authorUid` from
  its document (not merely from a response) and sets `deletedAt`/
  `deletedBy`, leaving only `teamId`/`threadId`/`createdAt`/`deletedAt`/
  `deletedBy` — the reply's plaintext is impossible to recover from this
  document ever again, by any operation, because the encrypted content no
  longer exists in it. The document itself is retained (not hard-deleted)
  solely to preserve its position in the reply list (BR-39).
- **BR-27**: `deleteReply` is idempotent — calling it again on an
  already-tombstoned reply succeeds as a no-op, with no further field
  change, for **any authenticated caller**, not only the reply's original
  author or an app admin. A tombstone retains no `authorUid` (BR-26), so
  there is no persisted identity left to re-authorize a repeat call
  against; `deleteReply` checks tombstone state *before* authorization
  specifically so that a retried or lost-response call is never met with a
  spurious `forbidden`, without ever reconstructing or reintroducing the
  erased identity to authorize it. This idempotent-success check still
  runs strictly after the operation's own `teamId`/`threadId` cross-check
  (BR-32, BR-35), so a wrong-team/wrong-thread tombstone continues to
  resolve to `not_found` and never becomes an existence oracle.
  `deleteThread` is **not** idempotent in the same sense: calling it again
  on an already-deleted thread returns `not_found`, since a hard-deleted
  thread's document is indistinguishable from one that never existed —
  this still leaves the caller in their desired end state ("this thread
  does not exist") without a distinct error condition to handle.
- **BR-28**: `deletedBy` is persisted only on a reply's content-erasing
  tombstone (for internal accountability) and is never returned by any API
  response. A hard-deleted thread persists no `deletedBy` at all — mirrors
  Anonymous Challenges' `deleteChallenge`, which also leaves no structured
  deletion record beyond ordinary, content-free server request logs.
- **BR-29**: No edit operation exists anywhere in this feature — a
  thread's title/body and a reply's body are immutable from creation until
  deletion.
- **BR-30**: No "un-delete"/"restore" operation exists anywhere in this
  feature — a hard-deleted thread has no document to restore from, and a
  tombstoned reply has no encrypted content left to restore.
- **BR-31**: Deletion is not gated on the owning team's
  `active`/`disabled` status.
- **BR-32**: Every management operation re-verifies the target's own
  persisted `teamId` (and, for a reply, its `threadId`) equals the
  caller's route scope; a mismatch is rejected `not_found`, never silently
  acted on.

**Firestore / infrastructure**
- **BR-33**: `forumThreads` and `forumReplies` each have an explicit
  client-SDK deny-all block in `firestore.rules`, identical in form to
  every existing collection's block.
- **BR-34**: `listTeamThreads` and `getThreadWithReplies` each use exactly
  one composite index (`teamId`+`createdAt desc` and `threadId`+
  `createdAt asc` respectively); the reply-cap count query (BR-52) and the
  thread-delete cascade query need no composite index. No other Firestore
  index is introduced by this feature.
- **BR-35**: Every reply document independently stores its own `teamId`
  while active, denormalized from its parent thread at creation time;
  every read/management operation on a reply cross-checks this field
  against the parent thread's own `teamId` (a tombstoned reply retains
  `teamId` specifically so this cross-check remains possible on any future
  access attempt).

**Logging**
- **BR-36**: No operation in this feature logs thread/reply plaintext,
  ciphertext, or any decrypted value, on any success or failure path.

**UI**
- **BR-37**: `/teams/[teamId]` shows the team's thread list to any
  authorized member/admin, with a "start a new thread" action available
  only to a real team member.
- **BR-38**: A thread's detail view shows its title, body, `authorTag`,
  and its replies in chronological order, with a reply-submission panel
  available to a real team member (disabled once the thread is at its
  500-reply capacity — BR-52).
- **BR-39**: A deleted reply renders as a distinct, non-identifying
  placeholder in its original position — never simply omitted, never
  showing its original content or author.
- **BR-40**: A thread's own author, or an app admin, sees a delete action
  for that thread (with confirmation copy stating that its replies are
  also permanently removed); a reply's own author, or an app admin, sees a
  delete action for that reply — no one else. Delete requires an explicit
  confirmation step before it executes.
- **BR-41**: Internal/technical values are never shown to a user — every
  surface uses Norwegian, non-technical labels and copy sourced from a
  feature copy module.
- **BR-42**: No reaction, voting, categorization/tag, mention,
  notification, search, pinning, locking, or AI-classification feature
  exists anywhere in this UI.
- **BR-43**: Every form control has a real associated label and a visible
  validation-error state; every action button is keyboard-operable with a
  visible focus state; tombstone state is never conveyed by color alone.
- **BR-44**: Loading, empty, success, validation-error, authorization-
  failure, and infrastructure-failure states are each explicitly designed
  for the thread list, thread detail, create-thread, and create-reply
  surfaces.
- **BR-45**: The forum section's own fetch/mutation failures are isolated
  from, and never hide, the team page's existing results/current-survey/
  challenges sections, and vice versa.
- **BR-46**: A create-thread, create-reply, or delete response that
  resolves after the caller has signed out, or after navigation to a
  different `teamId`/thread, is discarded rather than applied to a stale
  view.

**Cross-feature clarity**
- **BR-47**: The server never accepts a client-supplied `threadId`/
  `replyId`, `authorUid`, `authorTag`, `deletedAt`, or `deletedBy` when
  creating or deleting a thread/reply.
- **BR-48**: Thread/reply content is never aggregated or suppressed by a
  response-count threshold — every authorized reader sees full,
  individually attributed content, by design.
- **BR-49**: `authorTag` is never an email address, real name, `uid`, or
  any other contact-reachable or directly identifying value — it is an
  opaque, deterministic per-team pseudonymous label (see "Identity/
  attribution model" → "Author tag derivation"). This feature introduces
  no new member-to-member identity disclosure beyond authorship
  *continuity* within a team (recognizing that two posts share an author),
  which is strictly narrower than real-name or email-based attribution.

**Reply capacity and cascade deletion (new in this revision)**
- **BR-50**: `authorTag` is computed as `uppercase(hex(SHA-256(
  \`${teamId}:${authorUid}\`)).slice(0, 6))` — a pure, deterministic
  function of `(teamId, authorUid)` alone, requiring no persisted field, no
  Firestore read, and no Firebase Auth call. The identical author receives
  the identical tag for every thread/reply they create within one team,
  and a different tag in every other team they belong to.
- **BR-51**: A 6-hex-character `authorTag` collision between two different
  authors within the same team is a possible, extremely low-probability
  (≈`N²/2²⁵` for `N` authors in a team), accepted residual risk — at worst
  a display ambiguity (two authors appear under one label), never an
  identity leak.
- **BR-52**: `createReply` is rejected with a `thread_full` outcome once
  the target thread already has 500 replies, checked via a Firestore
  count-aggregation query — a genuine v1 capacity limit enforced at
  creation time, not merely a read-side display cutoff.
- **BR-53**: The 500-reply cap is enforced on a best-effort,
  non-transactional basis — a rare concurrent-creation race could produce
  up to one reply over the nominal cap; this is accepted and does not
  compromise any other requirement in this feature.
- **BR-54**: `deleteThread`'s reply cascade repeatedly queries and
  batch-deletes a thread's replies (each batch bounded to Firestore's own
  per-batch write limit) until none remain, rather than assuming a single
  bounded batch is always sufficient — correct regardless of whether
  BR-53's rare race ever caused a thread to exceed its nominal 500-reply
  cap.
- **BR-55**: `deleteThread` deletes the thread document first, then
  cascades to its replies — never the reverse order — minimizing (though
  not perfectly eliminating) the window in which an orphaned, permanently
  unreachable reply document could persist after its thread is gone (see
  "Edge cases and concurrency").
- **BR-56**: A reply document is valid only in one of two shapes: a
  well-formed *active* shape (all content and identity fields present, no
  `deletedAt`) or a well-formed *tombstone* shape (`deletedAt`/`deletedBy`
  present, and `ciphertext`/`iv`/`authTag`/`keyVersion`/`authorUid` all
  absent). `isValidForumReply` treats any other combination (e.g. both
  present, or partially present) as invalid/malformed, never as a
  tombstone to render or an active record to decrypt.

## Open questions
None. Both decisions originally recorded here (author-display/email
exposure; deleted-content retention) have been made by the product owner
and are now encoded as resolved design throughout this document — see
"Owner decisions" at the top of this file, "Identity/attribution model"
(Decision 1), and "Lifecycle/moderation"/"Data model" (Decision 2).

All other decisions in this document (team-scoped-only, no edit, flat
non-nested replies, no reply count, encrypting content, the specific
title/body/reply character bounds, no rate limiting, the 200-thread-list
bound, the 500-reply capacity limit, deleted content never being
re-readable by anyone including admins) are treated as resolved product/
architecture decisions for v1, made under the brief's explicit "prefer the
smallest useful v1" guidance — not open questions — with rationale
recorded inline above so they can be revisited deliberately, not
rediscovered as an oversight.
