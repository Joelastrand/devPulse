import { describe, expect, it } from "vitest";
import { Cloud, CodeXml, FlaskConical, Layers, Monitor, ShieldCheck } from "lucide-react";
import { AREA_TONE_CLASSES, areaVisualFor } from "./area-visual";

describe("areaVisualFor", () => {
  it.each([
    ["Testautomatisering", FlaskConical, "green"],
    ["Observerbarhet", Monitor, "blue"],
    ["Systemdesign", Layers, "purple"],
    ["Integrasjoner", CodeXml, "amber"],
    ["Sikkerhet", ShieldCheck, "rose"],
    ["Skytjenester", Cloud, "teal"],
  ])("maps %s to its icon and tone", (name, icon, tone) => {
    expect(areaVisualFor(name, "tree-x")).toEqual({ icon, tone });
  });

  it("gives an unknown area a deterministic fallback from its tree id", () => {
    const first = areaVisualFor("Ukjent område", "tree-42");
    expect(areaVisualFor("Ukjent område", "tree-42")).toEqual(first);
    expect(Object.keys(AREA_TONE_CLASSES)).toContain(first.tone);
  });

  it("falls back deterministically when the name is unavailable", () => {
    expect(areaVisualFor(null, "tree-42")).toEqual(areaVisualFor(null, "tree-42"));
  });
});
