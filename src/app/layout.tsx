import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/use-auth";
import { RouteAccessibility } from "@/components/route-accessibility";

export const metadata: Metadata = {
  title: "SplitSync",
  description: "Split expenses with friends and groups, settled simply.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased selection:bg-primary/20">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <RouteAccessibility />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
