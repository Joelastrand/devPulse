/**
 * The persisted shape of `teamSurveyState/{teamId}` (docs/features/
 * managed-surveys/SPEC.md — "One open survey per team"): the sole
 * enforcement point for "at most one genuinely open survey per team",
 * keyed by a deterministic document ID (`teamId` itself) so `openSurvey`'s
 * transaction always reads/writes exactly one document for the whole
 * team, never a query. Write-side coordination only — no read path in
 * this feature ever trusts this document as "the current survey" (that's
 * a direct `surveys` query by `teamId`, computing `effectiveLifecycle`
 * itself — a later task's job).
 */
export interface TeamSurveyState {
  activeSurveyId: string | null;
  updatedAt: Date;
}

/**
 * Fail-closed read of a raw `teamSurveyState` document's `activeSurveyId`
 * field: a missing document, a missing field, an explicit `null`, or any
 * malformed (non-string, or empty-string) value are all treated
 * identically as "no active pointer" — mirrors the existing
 * `isValidMembershipFor`/`isValidTeamStatus` "missing/malformed ⇒ no
 * grant" convention. Never throws.
 *
 * The caller (`openSurvey`) is responsible for then re-deriving whatever
 * survey a valid pointer names — the pointer's mere presence is never
 * trusted as "still open" (SPEC → "the pointer is never trusted by its
 * mere presence, only by re-deriving the survey it names").
 */
export function readActiveSurveyId(rawData: unknown): string | null {
  if (typeof rawData !== "object" || rawData === null) {
    return null;
  }

  const value = (rawData as Record<string, unknown>).activeSurveyId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
