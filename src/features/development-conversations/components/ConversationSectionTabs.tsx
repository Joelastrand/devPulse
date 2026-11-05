"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Section tabs for the conversation detail (visual-redesign TASK-013, decision A). Each tab shows one group of the
 * existing sections. Every panel stays mounted and only the inactive panels are hidden with CSS, so unsaved drafts in
 * a section survive a tab switch and no workflow state resets. Keyboard: Arrow keys, Home and End move between tabs
 * with automatic activation; the active tab is the only tab in the tab order.
 */
export interface ConversationSectionTab {
  id: string;
  label: string;
  children: ReactNode;
}

export function ConversationSectionTabs({ tabs, label }: { tabs: readonly ConversationSectionTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    setActive(tab.id);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") select((index + 1) % tabs.length);
    else if (event.key === "ArrowLeft") select((index - 1 + tabs.length) % tabs.length);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(tabs.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2 border-b border-border-subtle">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                selected ? "border-primary text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          tabIndex={0}
          className={tab.id === active ? "flex min-w-0 flex-col gap-6" : "hidden"}
        >
          {tab.children}
        </div>
      ))}
    </div>
  );
}
