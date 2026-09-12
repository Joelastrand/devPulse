export type PageHeaderSize = "md" | "lg";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** `lg` matches Home's larger treatment; `md` (default) matches every other in-scope page. */
  size?: PageHeaderSize;
}

const TITLE_SIZE_CLASSNAMES: Record<PageHeaderSize, string> = {
  md: "text-2xl font-semibold text-zinc-900 dark:text-zinc-50",
  lg: "text-3xl font-semibold text-zinc-900 dark:text-zinc-50",
};

/**
 * Shared page-header primitive (title heading + optional one-line
 * description) consolidating this codebase's repeated
 * `<h1>` + `<p className="mt-1 text-sm ...">` pairing, per
 * docs/features/product-ux-shell/SPEC.md BR-8. Always renders exactly one
 * `<h1>` — the page's top-level heading — never a lower level.
 */
export function PageHeader({ title, description, size = "md" }: PageHeaderProps) {
  return (
    <div>
      <h1 className={TITLE_SIZE_CLASSNAMES[size]}>{title}</h1>
      {description ? (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      ) : null}
    </div>
  );
}
