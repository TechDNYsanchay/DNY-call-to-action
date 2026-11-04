import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Devanagari, Newsreader } from "next/font/google";

// Shift Sheet type: Plex Sans for everything, Plex Mono for timestamps and numerals,
// Newsreader for the one-line outcome ("the minute") only. Devanagari glyphs download only when
// a Hindi quote is on the page (unicode-range subset).
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["500"],
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
});

const plexDevanagari = IBM_Plex_Sans_Devanagari({
  variable: "--font-plex-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
});

export const fontClasses = `${plexSans.variable} ${plexMono.variable} ${newsreader.variable} ${plexDevanagari.variable}`;
