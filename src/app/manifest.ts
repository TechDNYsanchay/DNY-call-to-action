import type { MetadataRoute } from "next";

// Installable on a phone home screen; the colours are the canvas and ink tokens (light theme).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Call to Action",
    short_name: "Actions",
    description: "DNY Hospitality client meetings, turned into one clear sheet of actions.",
    start_url: "/meetings",
    scope: "/",
    display: "standalone",
    background_color: "#e8ebe7",
    theme_color: "#e8ebe7",
    lang: "en",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
