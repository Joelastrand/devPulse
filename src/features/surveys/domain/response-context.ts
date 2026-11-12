/**
 * AAD of one survey response's sealed answers: the team, the survey and this response document. A ciphertext moved to
 * another response, survey or team fails authentication. The response id is the document's own Firestore id, and it is
 * never linked to any participation record, so the context carries no identity (SECURITY.md, anonymity).
 *
 * Declared in the domain layer so the write path (surveys) and the aggregate readers (results, surveys) share one
 * definition without importing each other's server modules.
 */
export function surveyResponseContext(teamId: string, surveyId: string, responseId: string): string {
  return `survey-response:${teamId}:${surveyId}:${responseId}`;
}
