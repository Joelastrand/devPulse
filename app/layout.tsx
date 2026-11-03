import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SkipLink } from "../src/components/ui/SkipLink";
import { THEME_INIT_SCRIPT } from "../src/lib/theme/theme";
import { homeCopy } from "./page.copy";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The application's only user-facing language is Norwegian
// (docs/UI-UX.md — Language; docs/features/product-ux-shell/SPEC.md —
// BR-1). Reuses the existing Home copy rather than introducing a second,
// slightly different Norwegian phrasing for the same product description.
export const metadata: Metadata = {
  title: homeCopy.title,
  description: homeCopy.description,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme="light" is the server default. The inline script below may
    // switch it before first paint, which is why hydration warnings are
    // suppressed on <html> only.
    <html
      lang="no"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
