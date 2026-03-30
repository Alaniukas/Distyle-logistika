import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Logistikos platforma",
  description: "Užsakymai ir vežėjų užklausos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="lt"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white shadow-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/orders" className="text-sm font-semibold text-slate-900">
              Logistikos platforma
            </Link>
            <nav className="flex gap-5 text-sm text-slate-700">
              <Link href="/orders" className="hover:text-slate-900 hover:underline">
                Užsakymai
              </Link>
              <Link
                href="/orders/new"
                className="text-slate-500 hover:text-slate-900 hover:underline"
              >
                Naujas užsakymas
              </Link>
            </nav>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
