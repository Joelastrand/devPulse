import type { CSSProperties } from "react";
import { Alert } from "./Alert";

/**
 * Reserves the box of a chart that is code-split out of the current bundle (`next/dynamic`). The box is `aria-hidden`
 * and carries no content: the chart's text alternative (table or list) renders with the chart, not with this box.
 */
export function ChartPlaceholder({ className, style }: { readonly className: string; readonly style?: CSSProperties }) {
  return <div aria-hidden="true" className={className} style={style} />;
}

/** Fallback for a chart whose code failed to load or render. Static text only; never shows the underlying error. */
export function ChartLoadError() {
  return <Alert variant="error">Diagrammet kunne ikke lastes.</Alert>;
}
