const NORWEGIAN_DATE = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", year: "numeric" });
const NORWEGIAN_DATE_TIME = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * A due date (`YYYY-MM-DD`) in Norwegian form. It is built from its parts as a local date, never parsed as UTC, so the
 * day cannot shift for a viewer east or west of UTC.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return NORWEGIAN_DATE.format(new Date(year, month - 1, day));
}

/** A server timestamp (ISO string) in Norwegian form, with the local time. */
export function formatTimestamp(iso: string): string {
  return NORWEGIAN_DATE_TIME.format(new Date(iso));
}

/** Today's calendar date as `YYYY-MM-DD` in the viewer's local calendar, used only for the overdue presentation. */
export function todayIsoDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
