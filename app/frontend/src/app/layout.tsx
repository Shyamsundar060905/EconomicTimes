import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { CityProvider } from "@/lib/CityContext";
import { ToastProvider } from "@/components/Toast";

/* Self-hosted at build time and preloaded. The old stylesheet `@import` from
   fonts.googleapis.com blocked first paint on a third-party round-trip, so the
   whole app rendered once in a fallback face and then reflowed — the single
   most visible "not smooth" moment in the product. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-jb",
  display: "swap",
});

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
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Apply the saved/preferred theme BEFORE first paint — no flash of the
            wrong theme. Reads localStorage, falls back to the OS preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aq-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <CityProvider>
          <ToastProvider>{children}</ToastProvider>
        </CityProvider>
      </body>
    </html>
  );
}
