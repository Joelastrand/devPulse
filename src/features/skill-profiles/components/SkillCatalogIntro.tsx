import type { ReactNode } from "react";
import { CollapsibleSection } from "../../../components/ui/CollapsibleSection";

/**
 * Short introduction to one skill catalog, with the ownership and privacy explanation behind a disclosure. Presentation
 * only: the wording comes from `skillCatalogCopy`, so the privacy statements are written once and reused by each view.
 */
export function SkillCatalogIntro({
  id,
  intro,
  whatIsTitle,
  whatIsBody,
  children,
}: {
  readonly id: string;
  readonly intro: string;
  readonly whatIsTitle: string;
  readonly whatIsBody: readonly string[];
  /** Optional navigation from the explanation, such as a link to the sharing settings. */
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-sm text-text-secondary">{intro}</p>
      <CollapsibleSection id={id} title={whatIsTitle} headingLevel={2}>
        <div className="flex max-w-prose flex-col gap-3 text-sm text-text-secondary">
          {whatIsBody.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {children}
        </div>
      </CollapsibleSection>
    </div>
  );
}
