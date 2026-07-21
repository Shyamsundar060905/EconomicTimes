import type { Metadata } from "next";
import "./globals.css";
import { CityProvider } from "@/lib/CityContext";

export const metadata: Metadata = {
  title: "AirCase",
  description:
    "From AQI dashboards to enforcement dispatch — signal → attribution → action. " +
    "Names who is polluting, where, with what evidence, and what to do about it today.",
  keywords: ["air quality", "AQI", "pollution", "enforcement", "Delhi", "CAAQMS"],
  authors: [{ name: "AirCase" }],
  openGraph: {
    title: "AirCase",
    description: "AI-powered urban air quality intelligence for Delhi",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Apply the saved/preferred theme BEFORE first paint — no flash of the
            wrong theme. Reads localStorage, falls back to the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aq-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <CityProvider>{children}</CityProvider>
      </body>
    </html>
  );
}
