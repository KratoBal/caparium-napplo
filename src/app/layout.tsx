import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_COLOR } from "@/lib/app-theme";

export const metadata: Metadata = {
  title: "Cápárium nAPPló",
  description: "A Cápárium vízmérési és etetési naplója",
  // the home screen (Lili 2026-10-31, task caparium-webapp-ikon): the manifest (src/app/manifest.ts), the icons, and the iOS meta tags that make
  // the app open full screen with the name "Caparium" (iOS asks for the name itself when it is added)
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Caparium", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>{children}</body>
    </html>
  );
}
