import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { APP_LAST_CHANGE_AT, formatLastChangeForPl } from '@/lib/app-meta';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Domowy Księgowy",
  description: "PWA do zarządzania wydatkami",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Księgowy",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lastChangeLabel = formatLastChangeForPl(APP_LAST_CHANGE_AT);

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      >
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{children}</div>
          <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">
            Ostatnia zmiana aplikacji: {lastChangeLabel}
          </footer>
        </div>
      </body>
    </html>
  );
}
