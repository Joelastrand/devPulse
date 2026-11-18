import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./class-names";

/**
 * Static placeholder surfaces for loading states. Deliberately NOT animated:
 * the motion audit (motion-audit.test.ts) allows no looping animation, and a
 * still surface avoids constant repaint. Every skeleton is decorative and
 * hidden from assistive technology; the owning region announces loading once
 * (see `LoadingRegion`), so screen readers do not hear each block.
 */

const BLOCK_CLASSNAME = "rounded-control bg-surface-subtle";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Tailwind sizing classes, e.g. "h-4 w-1/2". Keep the final content's height here so the layout does not shift. */
  className?: string;
}

/** A single placeholder block. */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cx(BLOCK_CLASSNAME, className)} {...props} />;
}

export interface SkeletonTextProps {
  /** Number of text lines. The last line is shorter so it reads as a paragraph. */
  lines?: number;
  className?: string;
}

/** Paragraph-shaped placeholder. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx("h-4", index === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** Card-shaped placeholder that uses the same bordered surface as `Card`. */
export function SkeletonCard({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cx("rounded-surface border border-border-subtle bg-surface p-6 shadow-card", className)}
    >
      {children ?? <SkeletonText lines={2} />}
    </div>
  );
}

/**
 * Wraps a loading region: one visually hidden status message for assistive
 * technology, `aria-busy` on the region, and the placeholders marked
 * decorative. Use this at the region level, never on every skeleton element.
 */
export function LoadingRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
    </div>
  );
}
