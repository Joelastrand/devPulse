/**
 * Original, decorative product preview for the public home. It shows the
 * shape of the app (sidebar, cards, a trend line) without any figures, names
 * or personal data, so it makes no claim about real results.
 */
export function HomePreview() {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto w-full max-w-xl rounded-surface border border-border-subtle bg-surface p-3 shadow-elevated"
    >
      <div className="flex min-h-72 overflow-hidden rounded-control bg-canvas">
        <div className="hidden w-28 shrink-0 flex-col gap-3 bg-sidebar p-3 sm:flex">
          <span className="h-3 w-12 rounded-full bg-brand-600" />
          <span className="mt-3 h-6 rounded-control bg-sidebar-active" />
          <span className="h-3 w-16 rounded-full bg-sidebar-muted/60" />
          <span className="h-3 w-14 rounded-full bg-sidebar-muted/60" />
          <span className="h-3 w-12 rounded-full bg-sidebar-muted/60" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <span className="h-4 w-2/5 rounded-full bg-text-primary/80" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2 rounded-control border border-border-subtle bg-surface p-3">
              <span className="h-2.5 w-3/5 rounded-full bg-border-strong" />
              <span className="h-2 w-full rounded-full bg-surface-subtle">
                <span className="block h-2 w-3/4 rounded-full bg-primary" />
              </span>
              <span className="h-2 w-2/3 rounded-full bg-surface-subtle" />
            </div>
            <div className="flex flex-col gap-2 rounded-control border border-border-subtle bg-surface p-3">
              <span className="h-2.5 w-1/2 rounded-full bg-border-strong" />
              <span className="h-2 w-full rounded-full bg-surface-subtle">
                <span className="block h-2 w-1/2 rounded-full bg-primary" />
              </span>
              <span className="h-2 w-3/5 rounded-full bg-surface-subtle" />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 rounded-control border border-border-subtle bg-surface p-3">
            <span className="h-2.5 w-1/3 rounded-full bg-border-strong" />
            <svg viewBox="0 0 200 60" preserveAspectRatio="none" className="h-full min-h-20 w-full">
              <path
                d="M0 44 C 30 36, 50 40, 80 30 S 130 22, 160 14 S 190 12, 200 10"
                fill="none"
                className="stroke-primary"
                strokeWidth="2.5"
              />
              <path
                d="M0 52 C 40 48, 90 50, 130 42 S 180 38, 200 36"
                fill="none"
                className="stroke-chart-3"
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
