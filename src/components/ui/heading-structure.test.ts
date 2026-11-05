// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { expectHeadingStructure, expectNamedControls, visibleHeadingLevels } from "./heading-structure";

function fixture(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("expectHeadingStructure", () => {
  it("passes a route that owns its title with one level-1 heading first", () => {
    const root = fixture("<h1>Titel</h1><h2>Del</h2><h3>Undertittel</h3>");
    expect(() => expectHeadingStructure(root, { ownsPageTitle: true })).not.toThrow();
  });

  it("fails a route that owns its title when a second level-1 heading is visible", () => {
    const root = fixture("<h1>Titel</h1><h1>Andre</h1>");
    expect(() => expectHeadingStructure(root, { ownsPageTitle: true })).toThrow();
  });

  it("passes a composed view with no level-1 heading and fails one that adds a second h1", () => {
    expect(() => expectHeadingStructure(fixture("<h2>Del</h2>"), { ownsPageTitle: false })).not.toThrow();
    document.body.innerHTML = "";
    const withSecondH1 = fixture("<h1>Ekstra</h1><h2>Del</h2>");
    expect(() => expectHeadingStructure(withSecondH1, { ownsPageTitle: false })).toThrow();
  });

  it("fails a jump of more than one heading level", () => {
    const root = fixture("<h1>Titel</h1><h3>Hoppet over</h3>");
    expect(() => expectHeadingStructure(root, { ownsPageTitle: true })).toThrow();
  });

  it("ignores headings inside aria-hidden and hidden subtrees", () => {
    const root = fixture('<h1>Titel</h1><div aria-hidden="true"><h1>Skjult</h1></div><div hidden><h4>Skjult</h4></div>');
    expect(() => expectHeadingStructure(root, { ownsPageTitle: true })).not.toThrow();
  });
});

describe("visibleHeadingLevels", () => {
  it("reads role=heading with aria-level as that level, and without aria-level as level 2", () => {
    const root = fixture('<h1>Titel</h1><div role="heading" aria-level="3">Tre</div><div role="heading">To</div>');
    expect(visibleHeadingLevels(root)).toEqual([1, 3, 2]);
  });
});

describe("expectNamedControls", () => {
  it("passes a named icon-only button and fails an unnamed one", () => {
    const named = fixture('<button aria-label="Lukk"><svg aria-hidden="true"></svg></button>');
    expect(() => expectNamedControls(named)).not.toThrow();
    document.body.innerHTML = "";
    const unnamed = fixture('<button><svg aria-hidden="true"></svg></button>');
    expect(() => expectNamedControls(unnamed)).toThrow();
  });

  it("fails an unnamed link and passes a link with text", () => {
    expect(() => expectNamedControls(fixture('<a href="/x"></a>'))).toThrow();
    document.body.innerHTML = "";
    expect(() => expectNamedControls(fixture('<a href="/x">Gå til</a>'))).not.toThrow();
  });
});
