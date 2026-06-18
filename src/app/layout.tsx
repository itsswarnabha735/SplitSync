import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/hooks/use-auth";

export const metadata: Metadata = {
  title: "SplitSync",
  description: "Split expenses with friends and groups, settled simply.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
