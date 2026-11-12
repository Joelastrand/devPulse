import type { ReactNode } from "react";
import { cx } from "./class-names";
import { CONTAINER_CLASSNAMES, Container, type ContainerVariant } from "./Container";

export type PageShellWidth = "sm" | "lg" | "2xl" | "3xl" | "wide";

/**
 * The existing width tokens map onto the Product Experience containers
 * (docs/archive/features/product-experience/SPEC.md — Breakpoints and containers).
 * `wide` (admin) uses the main container: the SPEC defines no separate wide
 * width, so the admin pages share main's 1200 px cap.
 */
export const CONTAINER_FOR_WIDTH: Record<PageShellWidth, ContainerVariant> = {
  sm: "auth",
  lg: "survey",
  "2xl": "reading",
  "3xl": "main",
  wide: "main",
};

export const WIDTH_CLASSNAMES: Record<PageShellWidth, string> = {
  sm: CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH.sm],
  lg: CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH.lg],
  "2xl": CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH["2xl"]],
  "3xl": CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH["3xl"]],
  wide: CONTAINER_CLASSNAMES[CONTAINER_FOR_WIDTH.wide],
};

export interface PageShellProps {
  children: ReactNode;
  /** Mapped to a Product Experience container; see CONTAINER_FOR_WIDTH. */
  width?: PageShellWidth;
  /** Vertically centers content — the existing treatment for short auth/survey-form pages. */
  center?: boolean;
  className?: string;
}

/**
 * Shared application page shell: the outer region, the container and the
 * `<main>` landmark every route renders. Route content, copy and guards are
 * unchanged; only the surrounding width and surface use the new tokens.
 */
export function PageShell({ children, width = "3xl", center = false, className }: PageShellProps) {
  return (
    <div className={cx("flex flex-1 justify-center bg-canvas py-16", center && "items-center")}>
      <Container variant={CONTAINER_FOR_WIDTH[width]}>
        <main className={cx("w-full", className)}>{children}</main>
      </Container>
    </div>
  );
}
