"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * Lets an editable section on the conversation detail report whether its draft differs from the saved value. The detail
 * owns the set of dirty sections, so the in-app back link and the browser's leave prompt can ask before losing edits.
 */
export interface UnsavedChangesReporter {
  report(key: string, dirty: boolean): void;
}

const NO_REPORTER: UnsavedChangesReporter = { report() {} };

export const UnsavedChangesContext = createContext<UnsavedChangesReporter>(NO_REPORTER);

/**
 * Reports one section's dirty state. A change to `dirty` or a section unmount first clears the previous report, so a
 * section that is removed never leaves the detail believing it still has unsaved edits.
 */
export function useReportUnsaved(key: string, dirty: boolean): void {
  const reporter = useContext(UnsavedChangesContext);
  useEffect(() => {
    reporter.report(key, dirty);
    return () => reporter.report(key, false);
  }, [reporter, key, dirty]);
}
