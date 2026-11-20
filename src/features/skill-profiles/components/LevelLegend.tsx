import { SELF_ASSESSED_LEVELS } from "../domain/self-assessed-level";
import { SELF_ASSESSED_LEVEL_COPY, skillProfileCopy } from "../copy";

/**
 * The four canonical levels with their full wording (BR-30 "level descriptions"). One shared explanation per dataset, so
 * the per-skill rows do not repeat it. Collapsed by default; the rating buttons carry the same level names in their
 * accessible labels, so nothing depends on opening it.
 */
export function LevelLegend() {
  return (
    <details className="rounded-md border border-border-subtle p-3">
      <summary className="cursor-pointer text-sm font-medium text-text-primary">{skillProfileCopy.legendHeading}</summary>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {SELF_ASSESSED_LEVELS.map((level) => (
          <div key={level}>
            <dt className="font-medium text-text-primary">{SELF_ASSESSED_LEVEL_COPY[level].name}</dt>
            <dd className="text-text-secondary">{SELF_ASSESSED_LEVEL_COPY[level].description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
