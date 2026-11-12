import type { ReactNode } from "react";
import { cx } from "./class-names";

/**
 * Named content containers (docs/archive/features/product-experience/SPEC.md —
 * Breakpoints and containers). Widths are tokens in app/globals.css. They sit
 * beside `PageShell`, which existing pages keep until their migration tasks.
 */
export type ContainerVariant = "main" | "reading" | "survey" | "auth";

export const CONTAINER_CLASSNAMES: Record<ContainerVariant, string> = {
  main: "mx-auto w-full max-w-main px-4 md:px-8",
  reading: "mx-auto w-full max-w-reading px-4 md:px-8",
  survey: "mx-auto w-full max-w-survey px-4 md:px-8",
  auth: "mx-auto w-full max-w-auth px-4 md:px-8",
};

export interface ContainerProps {
  variant?: ContainerVariant;
  className?: string;
  children: ReactNode;
}

export function Container({ variant = "main", className, children }: ContainerProps) {
  return <div className={cx(CONTAINER_CLASSNAMES[variant], className)}>{children}</div>;
}
