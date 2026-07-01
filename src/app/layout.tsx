import type { Metadata, Viewport } from "next";
// Geist via the bundled `geist` package (fonts ship in node_modules as local
// woff2) instead of next/font/google — so `npm run build` needs NO network
// (the Google Fonts fetch was the only offline-build blocker). Same typeface,
// identical rendering; it just sets --font-geist-sans / --font-geist-mono,
// which globals.css aliases to --font-sans / --font-mono.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beacon",
  description: "Search visibility command center",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
