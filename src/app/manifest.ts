import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/lib/app-theme";

// The web app's manifest (Lili 2026-10-31, task caparium-webapp-ikon, card 135b457e): the app can be put on a phone's home screen with its logo and
// opens full screen (display: standalone). The colour is the teal of the logo's rim (src/lib/app-theme.ts). The short name is "Caparium" (Lili names it herself on iOS when adding it). The icons are public/icons/*, made from the
// logo by scripts/make-app-icons.mjs: full bleed (no transparent corner: iOS and Android round an icon themselves) and one maskable.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cápárium nAPPló",
    short_name: "Caparium",
    description: "A Cápárium vízmérési és etetési naplója",
    lang: "hu",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
