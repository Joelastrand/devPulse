import { Cloud, CodeXml, FlaskConical, Layers, Monitor, ShieldCheck, type LucideIcon, Layers3 } from "lucide-react";

/**
 * Presentation-only metadata for a competence area: an icon and one accent tone shared by the timeline bar, the row
 * icon and the detail card, so an area keeps the same look on every view. Colour is never the only signal: the area
 * name and the status text always carry the meaning. Nothing here is persisted or sent to the server.
 */
export type AreaTone = "green" | "blue" | "purple" | "amber" | "rose" | "teal" | "slate";

export interface AreaVisual {
  icon: LucideIcon;
  tone: AreaTone;
}

/** Static class names per tone. Tailwind needs literal strings, so each tone is spelled out in full. */
export const AREA_TONE_CLASSES: Readonly<
  Record<AreaTone, { text: string; subtle: string; fill: string; ring: string }>
> = {
  green: { text: "text-success-text", subtle: "bg-success-subtle", fill: "bg-success-text", ring: "ring-success-text/30" },
  blue: { text: "text-info-text", subtle: "bg-info-subtle", fill: "bg-info-text", ring: "ring-info-text/30" },
  purple: { text: "text-chart-2", subtle: "bg-chart-2/15", fill: "bg-chart-2", ring: "ring-chart-2/30" },
  amber: { text: "text-warning-text", subtle: "bg-warning-subtle", fill: "bg-warning-text", ring: "ring-warning-text/30" },
  rose: { text: "text-chart-4", subtle: "bg-chart-4/15", fill: "bg-chart-4", ring: "ring-chart-4/30" },
  teal: { text: "text-chart-1", subtle: "bg-chart-1/15", fill: "bg-chart-1", ring: "ring-chart-1/30" },
  slate: { text: "text-chart-5", subtle: "bg-chart-5/15", fill: "bg-chart-5", ring: "ring-chart-5/30" },
};

/** Keyword rules, matched case-insensitively against the area name. The first matching rule wins. */
const KEYWORD_RULES: readonly { pattern: RegExp; visual: AreaVisual }[] = [
  { pattern: /test/i, visual: { icon: FlaskConical, tone: "green" } },
  { pattern: /observ|logg|måling|monitor/i, visual: { icon: Monitor, tone: "blue" } },
  { pattern: /systemdesign|arkitektur|design/i, visual: { icon: Layers, tone: "purple" } },
  { pattern: /integrasjon|api|hendelse/i, visual: { icon: CodeXml, tone: "amber" } },
  { pattern: /sikkerhet|security|personvern/i, visual: { icon: ShieldCheck, tone: "rose" } },
  { pattern: /sky|cloud|infrastruktur/i, visual: { icon: Cloud, tone: "teal" } },
];

/** Used for names that match no rule. The palette is chosen deterministically from the tree id. */
const FALLBACK_PALETTE: readonly AreaTone[] = ["teal", "purple", "amber", "rose", "slate"];

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return hash;
}

/**
 * Icon and tone for a competence area. `name` may be null when the area is unavailable; the tree id then decides the
 * fallback, so the same area never changes colour between renders.
 */
export function areaVisualFor(name: string | null, planId: string): AreaVisual {
  const matched = name === null ? undefined : KEYWORD_RULES.find((rule) => rule.pattern.test(name));
  if (matched) {
    return matched.visual;
  }
  const hash = stableHash(planId);
  return { icon: Layers3, tone: FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length] ?? "slate" };
}
