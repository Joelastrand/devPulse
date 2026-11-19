"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Flag,
  GraduationCap,
  LayoutDashboard,
  Mail,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Icon } from "../../../components/ui/Icon";
import { parseAdminTeamTab, tabForLegacyHash, type AdminTeamTabId } from "../admin-team-tabs";

/** One icon per tab. Decorative: the visible label carries the accessible name. */
const TAB_ICONS: Readonly<Record<AdminTeamTabId, LucideIcon>> = {
  oversikt: LayoutDashboard,
  medlemmer: Users,
  roller: UserRoundCog,
  invitasjoner: Mail,
  undersokelser: ClipboardList,
  utfordringer: Flag,
  kompetanse: GraduationCap,
};

/**
 * URL-driven tab shell for `/admin/teams/[teamId]`. The active tab is the `tab` query parameter. Tab switches push a new
 * history entry through the Next router, so Back and Forward restore the previous tab. Invalid values fall back without a
 * rewrite. Every panel stays mounted and inactive panels get the `hidden` class, so unsaved drafts and in-flight
 * mutations survive a tab switch. The same approach is used by ConversationSectionTabs. Keyboard: Arrow keys, Home and
 * End move between tabs with automatic activation.
 */

interface AdminTeamTabPanelProps {
  id: AdminTeamTabId;
  label: string;
  children: ReactNode;
}

interface AdminTeamTabContextValue {
  active: AdminTeamTabId;
  baseId: string;
}

const AdminTeamTabContext = createContext<AdminTeamTabContextValue | null>(null);

function tabElementId(baseId: string, id: AdminTeamTabId): string {
  return `${baseId}-tab-${id}`;
}

function panelElementId(baseId: string, id: AdminTeamTabId): string {
  return `${baseId}-panel-${id}`;
}

/** One direct child of `AdminTeamTabs`. Its `label` and `id` drive the tab bar; visibility comes from context. */
export function AdminTeamTabPanel({ id, children }: AdminTeamTabPanelProps) {
  const context = useContext(AdminTeamTabContext);
  if (!context) {
    throw new Error("AdminTeamTabPanel must be rendered inside AdminTeamTabs.");
  }
  const selected = context.active === id;
  return (
    <div
      role="tabpanel"
      id={panelElementId(context.baseId, id)}
      aria-labelledby={tabElementId(context.baseId, id)}
      tabIndex={0}
      className={selected ? "flex min-w-0 flex-col gap-6" : "hidden"}
    >
      {children}
    </div>
  );
}

interface TabDescriptor {
  id: AdminTeamTabId;
  label: string;
}

function collectTabs(children: ReactNode): TabDescriptor[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<AdminTeamTabPanelProps>(child) ? [{ id: child.props.id, label: child.props.label }] : [],
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function AdminTeamTabs({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tabs = collectTabs(children);
  const active = parseAdminTeamTab(searchParams.getAll("tab"));

  // Legacy bookmarks to `#admin-section-*` anchors: select the tab that now contains the section. `replace` keeps the
  // normalization out of the history stack. The effect runs only while no `tab` parameter is present, so it cannot loop.
  useEffect(() => {
    if (searchParams.getAll("tab").length > 0) return;
    const legacyTab = tabForLegacyHash(window.location.hash);
    if (legacyTab === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", legacyTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  function activate(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    const list = listRef.current;
    if (list && list.getBoundingClientRect().top < 0) {
      list.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    buttonRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (tabs.length === 0) return;
    if (event.key === "ArrowRight") activate((index + 1) % tabs.length);
    else if (event.key === "ArrowLeft") activate((index - 1 + tabs.length) % tabs.length);
    else if (event.key === "Home") activate(0);
    else if (event.key === "End") activate(tabs.length - 1);
    else return;
    event.preventDefault();
  }

  // overflow-y-hidden is required: setting overflow-x to auto forces overflow-y to auto as well, which showed vertical
  // scroll arrows. Tab buttons therefore stay inside the box (no negative margin) and use inset focus rings so the
  // outline is not clipped by the scroll container.
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-border-subtle"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabElementId(baseId, tab.id)}
              aria-selected={selected}
              aria-controls={panelElementId(baseId, tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => activate(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors duration-micro ease-standard focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 ${
                selected
                  ? "border-primary bg-primary-subtle font-semibold text-text-primary"
                  : "border-transparent font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
              }`}
            >
              <Icon icon={TAB_ICONS[tab.id]} size="inline" className={selected ? "text-primary" : undefined} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <AdminTeamTabContext.Provider value={{ active, baseId }}>{children}</AdminTeamTabContext.Provider>
    </div>
  );
}
