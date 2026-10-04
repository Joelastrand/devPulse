"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type RoadmapView = "list" | "timeline";

/** Closed enum: only `timeline` selects the timeline, anything else is the list (SPEC BR-13). */
export function parseRoadmapView(value: string | null): RoadmapView {
  return value === "timeline" ? "timeline" : "list";
}

/**
 * The selected roadmap view, held in the `view` query parameter only. Switching
 * replaces the history entry and keeps every unrelated parameter; the list
 * (default) is represented by the absence of the parameter. An invalid value is
 * read as the list without rewriting the URL.
 */
export function useRoadmapView(): { view: RoadmapView; setView: (next: RoadmapView) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseRoadmapView(searchParams.get("view"));

  function setView(next: RoadmapView) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "timeline") params.set("view", "timeline");
    else params.delete("view");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { view, setView };
}
