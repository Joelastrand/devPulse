import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "../src/components/nav/SiteHeader";
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
    <html
      lang="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
