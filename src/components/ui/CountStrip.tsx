export interface CountStripItem {
  label: string;
  value: number;
}

/**
 * A compact, non-interactive row of counts (`dl` of label/value pairs). Counts must be derived from data the caller has
 * already loaded. This primitive does not fetch anything, and it is not a navigation element.
 */
export function CountStrip({ items }: { items: ReadonlyArray<CountStripItem> }) {
  return (
    <dl className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline gap-2 rounded-control border border-border-subtle bg-surface px-3 py-1.5"
        >
          <dt className="text-sm text-text-secondary">{item.label}</dt>
          <dd className="text-base font-semibold tabular-nums text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
