import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minimal Realtime Board Games",
  description: "Ultra-minimal offline-first realtime turn-based board games",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased selection:bg-neutral-900 selection:text-white">
        <main className="flex min-h-screen w-full flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}
