/**
 * Presentation-only date helpers for the survey-instance results/history
 * view (docs/features/managed-surveys/SPEC.md — "Results/history model",
 * "Chart X-axis decision"). Pure, no persistence, no server dependency —
 * `formatRelativeSurveyDate` is always computed client-side from the
 * current date at render time, never persisted or fetched (SPEC's explicit
 * requirement), and is secondary/non-load-bearing context alongside the
 * authoritative `formatSurveyDate` label.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH_APPROX = 30;

/** e.g. "10. jan. 2026" — the authoritative, non-relative label for a closed survey (SPEC → "Sorting/display date"). */
export function formatSurveyDate(date: Date): string {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Secondary relative label (e.g. "2 uker siden") — never a substitute for
 * `formatSurveyDate` and never persisted (SPEC → "Chart X-axis decision").
 * `now` is always the caller's own current time, passed explicitly so this
 * function stays pure and testable rather than reading the clock itself.
 */
export function formatRelativeSurveyDate(date: Date, now: Date): string {
  const diffDays = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);

  if (diffDays <= 0) {
    return "i dag";
  }
  if (diffDays === 1) {
    return "1 dag siden";
  }
  if (diffDays < DAYS_PER_WEEK) {
    return `${diffDays} dager siden`;
  }
  if (diffDays < DAYS_PER_MONTH_APPROX) {
    const weeks = Math.floor(diffDays / DAYS_PER_WEEK);
    return weeks === 1 ? "1 uke siden" : `${weeks} uker siden`;
  }

  const months = Math.floor(diffDays / DAYS_PER_MONTH_APPROX);
  return months <= 1 ? "1 måned siden" : `${months} måneder siden`;
}
