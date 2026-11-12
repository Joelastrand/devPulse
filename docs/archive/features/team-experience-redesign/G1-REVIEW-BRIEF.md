# G1 security review brief: Amendment A numeric team radar (k = 3)

**Status: prepared for independent security review (G1). Not approved. Nothing here is activated.**
Prepared 2026-11-07. Product direction approved by the owner (R-1 to R-4, numeric radar). This brief asks for a security
decision on the design. It does not ask the reviewer to accept the product decision, which is already recorded.

## 1. What is being reviewed

- `docs/features/team-experience-redesign/AMENDMENT-A-DRAFT.md`: §A.0 (G0 record), §A.2 (invariants 32–36 draft review text),
  §A.3 (self-assessment edits as publication inputs, K3-8), §A.4 (radar publication), §A.5 (anti-probing), §A.13 (inference
  risk, computed), §A.14 (approvals), §A.15 (anti-probing preserved).
- `docs/SECURITY.md`: **unchanged.** Its uncommitted diff (superadmin registry, TA-SI) is a separate change and is not part of
  this review.

## 2. The design in one paragraph

For each team and competence need, at a publication boundary, the server computes one integer team level 1–4: the rounded
arithmetic mean of the eligible contributors' valid levels, with exact half-up rounding and integer arithmetic only. The
minimum is three eligible contributors per area, with no team-size floor. Fewer than three gives `insufficient_data`. A
per-need change flag, set atomically by any self-assessment edit that is an input, suppresses that need for one period. The
publication is the only persisted state derived from personal assessments, apart from that flag. The team API returns only
the publication or collaborative values, never individual ratings or contributor counts.

## 3. Decisions the reviewer is asked to make

1. **Invariant 35 (version 2).** Is one integer per team and need, plus the per-need flag, acceptable as the only derived
   persisted state? Is the exact aggregate rule acceptable, and does the "no sum, minimum, maximum, median or count stored"
   list hold in code?
2. **Inference for exactly three contributors (§A.13).** The table shows that one published value, with the reader's own level,
   can determine the other two members' combined level to a range, and uniquely in 2 of 12 cases. Is the residual
   acceptable as stated, or does the design need a change (for example a different aggregate, or a different treatment of n = 3)?
   The owner has accepted the inference risk. The reviewer decides whether the technical residual is acceptable under
   invariant 35, which is a separate question.
3. **Cross-period tracking (§A.13).** A change by another member suppresses one period and then publishes a new value. Is a
   member's tracking of the others' combined level bounded enough by boundary-only publication, the 30-day period (K3-3,
   provisional) and the one-edit-per-period rule? Recompute the bit budget for the numeric output; the categorical budget in
   §A.5.5 does not apply.
4. **Invariant 36 (draft).** Does the write-authority wording match the Firestore rules and the write paths? Specifically:
   members write only their own participation and levels; teamadmins write only their team's needs, mode and collaborative
   values; publication and flag writes are server-only; no teamadmin capability reads `skillProfiles`.
5. **K3-8 atomicity.** A level write and its flag write are one transaction, and a failed flag write fails the level write.
   Is the cross-feature write from C1 (`set-own-skill-level`, `clear-own-skill-level`, `delete-own-skill-profile`) safe?
6. **K3-7.** Removing `requiredCoverage` from member DTOs. Confirm the DTO allow-lists.
7. **K3-9 audit.** Is a separate server-only authorized audit record needed for mode changes? The draft has no actor field on
   `teamProfileSettings`.
8. **Endpoint inventory (§A.5.6).** Is the new `competence-profile` route the only route that returns numeric team levels, and
   does every route in the inventory read only the permitted sources?

## 4. Specific risks the reviewer should check

- **A1 (withdrawal), A4 (opt-in), A2 (cut-point sweep).** §A.15 lists how each is handled. None is implemented yet.
- **Malicious lead or teamadmin.** A teamadmin without a level sees only the integer. A lead who is also a contributor has
  the same position as a member. Verify no lead route can change a member's input to set a probe.
- **Small-team display.** A three-person team shows a value that describes all three members. The notice must say so (§A.6).
- **Logs and errors.** Failure categories only; no level, count or name (§A.5.6).
- **Erasure.** The publication and flag hold no person data, but the erasure inventory must classify them and clear any
  flag tied to an erased member's contribution. This is not yet written.

## 5. Not decided and not part of this review

- Period length P (K3-3): provisional at 30 days, to be confirmed by this review (approval item 8).
- Notice transition and version bump (G5), notice copy (G4), privacy and legal review (G2, L2, L6), UI-UX (G3).
- The Firestore rules change for the new collections (explicit deny blocks): a separate approved step.
- The SECURITY.md text itself: applied only after G1 and G2 are recorded.

## 6. Code that does not exist yet (so the review covers design only)

- The boundary publisher and `publication-period.ts`.
- `teamCoverageChange`, the publication collection and `teamProfileSettings`.
- Any `teamCompetenceAreas.teamLevel` write path (BLK-1).
- The `competence-profile` route.

The review should therefore cover the design and its tests (§A.7, §A.8), not an implementation.

## 7. Output requested from the reviewer

For each decision in §3: approve, approve with a named change, or reject with the reason. Also state whether the
inference residual in §A.13 is acceptable as written.
