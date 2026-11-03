/**
 * The three original DevPulse illustrations (docs/features/product-experience/SPEC.md —
 * Illustration strategy). Drawn for DevPulse, no third-party artwork. Grammar: a 160 x 120
 * frame, 1.5 px stroke, round caps and joins, geometric forms only, token colours only,
 * no text in the artwork. Each is aria-hidden: the surrounding copy carries the meaning.
 * Used only in these states: goals empty, conversations empty and survey completion.
 */
const SVG_PROPS = {
  viewBox: "0 0 160 120",
  width: 160,
  height: 120,
  fill: "none",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  focusable: "false" as const,
  className: "text-primary",
};

/** A goal board with a flag: the "no goals yet" state. */
export function GoalsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="44" y="22" width="72" height="76" rx="10" className="stroke-border-strong fill-surface" />
      <path d="M64 46h32M64 60h24" className="stroke-border-strong" />
      <path d="M92 74V44l20 6-20 6" className="stroke-primary fill-primary-subtle" />
      <circle cx="92" cy="74" r="3" className="fill-primary" />
    </svg>
  );
}

/** Two overlapping speech bubbles: the "no conversations yet" state. */
export function ConversationsIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <rect x="28" y="28" width="62" height="40" rx="10" className="stroke-border-strong fill-surface" />
      <path d="M44 68l-6 12 14-12" className="stroke-border-strong" />
      <rect x="70" y="50" width="62" height="40" rx="10" className="stroke-primary fill-primary-subtle" />
      <path d="M118 90l6 12-14-12" className="stroke-primary" />
    </svg>
  );
}

/** A circle with a tick: the completed-survey state. */
export function CompletionIllustration() {
  return (
    <svg {...SVG_PROPS}>
      <circle cx="80" cy="60" r="34" className="stroke-primary fill-primary-subtle" />
      <path d="M66 61l10 10 19-21" className="stroke-primary" />
    </svg>
  );
}
