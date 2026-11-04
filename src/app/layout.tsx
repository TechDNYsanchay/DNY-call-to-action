import type { Metadata, Viewport } from "next";
import { fontClasses } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Call to Action", template: "%s · Call to Action" },
  description: "DNY Hospitality client meetings, turned into one clear sheet of actions.",
  applicationName: "Call to Action",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8ebe7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1412" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the saved theme before first paint so there is no flash. Kept tiny and inline on purpose.
const themeScript = `(function(){try{var t=localStorage.getItem("cta-theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClasses} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
