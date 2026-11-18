import { vi } from "vitest";

/**
 * Test double for `next/navigation` used by the Systemoversikt component tests. `search` is the query string the page reads
 * on mount; `replace` records the URL the page writes. Tests reset both in `afterEach`.
 */
export const navigationState = {
  search: "",
  replace: vi.fn(),
};

export const navigationMock = {
  usePathname: () => "/teams/team-1/systems",
  useRouter: () => ({ replace: navigationState.replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationState.search),
};
