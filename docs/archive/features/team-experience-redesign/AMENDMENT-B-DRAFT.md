# Amendment B — default-on individual contribution and preservation of opt-out across rejoining (DRAFT, INACTIVE)

**Status: inactive draft. Not proposed for approval now.** Default-on sharing must not be activated, and nothing here may
be applied to `docs/SECURITY.md`, any SPEC, production code, consent records, notice versions, Firestore rules or shared
data, until the lawful-basis and privacy review in §B.6 is complete and the owner approves this amendment in writing.

Independent of Amendment A (`AMENDMENT-A-DRAFT.md`). Amendment A can be approved and activated without this document.
This document cannot be activated without the approvals of Amendment A that it depends on, listed in §B.7.

Current contract, in force: participation is an **affirmative, per-team, revocable opt-in**, **off** by default
(SECURITY invariant 32; SPEC P1 and BR-7/BR-9/BR-11). Nothing in this draft changes that.

---

## B.1 What the owner has asked for, and what is not yet authorized

| Owner requirement (product direction) | Authorized now? | Why not |
| --- | --- | --- |
| Private assessments are included by default for new memberships | **No** | Pre-set participation conflicts with invariant 32 and P1 ("no default, no pre-ticked control"). Lawful basis not established (§B.6) |
| Member can disable and re-enable at any time | Yes (existing behaviour) | Already implemented as withdrawal and opt-in |
| Opt-out preserved across team-mode changes and rejoining | Team-mode: **yes** (no change to membership). Rejoining: **no** | Preserving an opt-out after the membership ends needs a record outliving the membership. Current contract says participation is destroyed with the membership (SPEC BR-11; invariant 32; invariant 27) |
| Clearly explained to the member | Yes, as copy in Amendment A | Copy for default-on is in §B.5 and is not shown until activation |

## B.2 Proposed SECURITY.md wording (inactive)

### Invariant 32 — default clause (add; only if approved)

> 32. … *Default inclusion:* for a membership created on or after the constant `defaultOnEffectiveAt`, participation is
> **included by default**. It is operative only after the member has seen the current notice (recorded by the member's own
> action), and it is recorded as the member's own state. Participation is withdrawable at any time. No lead, team admin or
> app admin writes, sets or infers a member's participation. The grant transaction writes no participation field.

*Mechanism (recommended, from the D1 proposal §2a):* **derived at read time, not written on grant.** Inclusion is computed
from the membership's `createdAt` compared with `defaultOnEffectiveAt`, unless an explicit withdrawal record exists. Nothing
is written for the member at grant. This keeps the grant transaction unchanged and keeps every participation write made by
the member. Under this mechanism, invariant 32's "no negative state" sentence (P1) must also be amended, because a withdrawal
record is a negative state.

### Invariant 27 and SPEC BR-11 — rejoining (only if approved; see §B.3)

> 27. … A removed membership cannot be newly assigned. Its reference is destroyed with it. A rejoin receives a fresh
> reference. *Opt-out amendment:* the only record that survives a removal is `teamSharingWithdrawals/{uid}__{teamId}`
> (§B.3). It holds no reference, no identity other than the document key, and no other field.

## B.3 Rejoin preservation (R-A): exact record and lifecycle

**Record.** `teamSharingWithdrawals/{uid}__{teamId}`, single field `withdrawnAt` (server timestamp). Key is the same
deterministic form as the membership document. Written only by the member's own withdrawal action, in the same transaction
that deletes `skillContribution`. Deleted only by the member's own re-enable action. Not returned by any API other than the
member's own state read. Not read by coverage, profile, roster or any team DTO.

**Lifecycle.**

| Event | Effect on `teamSharingWithdrawals` |
| --- | --- |
| Member withdraws | Created (or updated); `skillContribution` deleted in the same transaction |
| Member re-enables | Deleted; `skillContribution` written with the current notice version |
| Membership removed (leave or removal) | **Unchanged** (this is the point of the record). `skillContribution` is deleted as today |
| Member rejoins, record present | New membership; the grant reads the record. Participation is **not** included, whatever `defaultOnEffectiveAt` says |
| Member rejoins, no record | New membership; default inclusion applies if active (§B.2), otherwise not participating |
| Account erasure | Record deleted. Erasure inventory row required (§B.4) |
| Team deleted or deactivated | Record kept until the member acts or the account is erased; no team-level effect |

**Why this is a privacy-sensitive record.** It links a person to a team they have left. It exists only because of a
requirement, and it has to be justified in the DPIA (§B.6, L3).

**Minimization options (for the owner; recommended order):**
1. Keep the record only while the person has a stored preference other than the default. A re-enable deletes it.
2. Automatic expiry after a fixed period after removal (for example 12 months). Needs an expiry job; deployment is an
   explicit request.
3. No record at all: rejoining resets the preference to the default. This **conflicts with the owner's requirement** and is
   listed for completeness.

## B.4 Erasure and inventory

- New inventory row for `teamSharingWithdrawals` (`src/features/account-erasure/server/inventory.ts`): personal data, owned
  by uid, destroyed on account erasure. A test asserts that erasure removes every record for the uid.
- `teamMemberships.skillContribution` remains a plain field, destroyed with the membership (unchanged).
- Amendment A records (`teamProfileSettings`, publication, change boolean) are non-personal and are not affected.
- No erasure path may leave a record that names a removed member after the member's erasure.

## B.5 Member-facing wording for default-on (draft; Norwegian; not shown until activation)

**Primary notice (replaces the Amendment A opening line only when default-on is active):**

- «Du er med i teamprofilen fra start, og dine nivåer brukes til å beregne den. Du kan slå av deling når som helst under
  Mine ferdigheter.»
- «Vi har valgt denne standarden for å gjøre teamprofilen nyttig for små team. Standarden er ikke et samtykke fra deg.
  Du kan endre den når som helst, og det vises tydelig hva som er valgt.»
- «Hvis du slår av deling, og senere blir med i et team igjen, vil valget ditt for teamet bli husket, til du endrer det.»

**Warning:** this copy must be reviewed together with §B.6. It describes a state the member did not affirmatively choose.
Copy that claims consent («Du har samtykket») is forbidden. Copy that claims the team profile is anonymous is forbidden.

## B.6 Lawful basis, DPIA and privacy review (required before activation)

The following are **owner and legal decisions**. This document gives no legal opinion.

- **L1. Lawful basis.** Under EU/EEA data-protection law, consent must be a freely given, specific, informed and unambiguous
  indication given by a clear affirmative act (GDPR Art. 4(11), Art. 7). A participation state that is set in advance is
  generally not that. If default-on is pursued, the basis must be something else, for example legitimate interests
  (Art. 6(1)(f)), with a documented balancing test and an effective right to object. Norwegian employment-data rules must
  also be checked. The owner must decide and document the basis. Until then, default-on is blocked.
- **L2. DPIA.** Automatic aggregation at three contributors, with the residuals in Amendment A §A.2, and the default
  visibility of the result to all members.
- **L3. Rejoin record.** Purpose, retention (§B.3 minimization), erasure (§B.4), and the change from "destroyed with the
  membership". Must be justified against the data-minimization principle.
- **L4. Notice transition for existing participants.** Existing opt-ins are affirmative and continue. A default-on change
  must not silently convert anyone who has not chosen. Transition must be decided with legal review.
- **L5. Withdrawal semantics under default.** Withdrawal must remain as easy as joining, and must not require a reason.
- **L6. Visibility.** Confirm that a default-included member's contribution is visible in the team radar to all members,
  including those who have not been told about the default (the answer depends on L1).

## B.7 Dependencies on Amendment A (must already be approved and implemented)

- §A.3 (self-assessment is a publication input) and §A.5 (anti-probing): default-on increases the number of contributors and
  therefore the number of publications that can be probed.
- §A.4 (radar publication) and §A.6 (notice contract at k = 3).
- The publication architecture (D1 proposal §10d), live under k = 5 before any default is considered.

## B.8 Activation gates (all required, none passed)

| Gate | Requirement |
| --- | --- |
| **B-G0** | Owner approves Amendment B in writing |
| **B-G1** | L1 (lawful basis) decided and documented by the owner, with legal review recorded |
| **B-G2** | L2 DPIA completed and signed by the privacy reviewer |
| **B-G3** | L3 rejoin record justified; minimization option chosen (§B.3) |
| **B-G4** | L4 transition chosen |
| **B-G5** | §B.5 wording reviewed by a Norwegian-speaking reviewer, with the L1 outcome reflected in the copy |
| **B-G6** | Amendment A approved and activated (§B.7) |
| **B-G7** | SECURITY.md invariants 27, 32 and 36 amended after B-G0; SPEC P1, BR-7, BR-9, BR-11 amended; team-experience BR-24 amended |
| **B-G8** | Notice version bumped with the transition chosen in B-G4 |

## B.9 Tests (activation only; written now as the specification)

- **Grant:** default inclusion is derived at read time for memberships at or after `defaultOnEffectiveAt`; the grant
  transaction writes no participation field (regression on `grant-team-membership.ts`, `create-invitation.ts`,
  `resolve-invitations.ts`, `approve-access-request.ts`).
- **Default:** a membership before `defaultOnEffectiveAt` is not included; a membership at or after it is included only
  after the member's seen-notice record (the member's own write); the seen record is never written by a GET.
- **Withdrawal:** immediate for every new computation; the withdrawal record is written in the same transaction; no admin
  route can write it (route and scope-guard tests).
- **Re-enable:** deletes the withdrawal record; writes `skillContribution` with the current notice version; the member's
  own action only.
- **Rejoin:** a rejoining member with a withdrawal record is not included; without one, the default applies (if active).
- **Leave:** removes `skillContribution`; keeps only `teamSharingWithdrawals`; a DTO test shows that no team DTO exposes the
  record.
- **Erasure:** removes `teamSharingWithdrawals` and every other record for the uid; the inventory test fails if a new
  collection holding the uid is not listed.
- **Non-exposure:** no DTO for another member contains the record, its timestamp, or its existence (extend the existing
  `participation-non-exposure.test.ts`).
- **Copy:** no string claims consent or anonymity; the default-on copy appears only when the constant is set.
- **Activation flip:** the existing test that asserts "a new member is not participating by default" flips only at B-G8,
  and the flip is recorded in the decision log. It is not changed silently.

## B.10 Owner decisions (Amendment B only)

- **B-D1.** Approve or reject default-on, after L1 is documented.
- **B-D2.** Rejoin: R-A with the minimization option in §B.3, or reject R-A and accept that a rejoin resets the preference
  (which conflicts with the stated requirement).
- **B-D3.** Notice transition for existing participants (L4).
- **B-D4.** Whether default inclusion applies to memberships that were granted by an access-request approval, invitation
  acceptance or admin grant alike (recommended: yes, same rule).
