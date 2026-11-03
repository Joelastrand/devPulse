import type { ReactNode } from "react";
import { AppShell } from "../../src/components/nav/AppShell";
import { TeamContextProvider } from "../../src/components/nav/TeamContext";

// Authenticated routes: the shell wraps the page content (sidebar from md,
// top bar with the drawer below md). The team context lets team pages name
// their team in the shell.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TeamContextProvider>
      <AppShell>{children}</AppShell>
    </TeamContextProvider>
  );
}
