import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AQ Intelligence Platform",
  description:
    "From AQI dashboards to enforcement dispatch — signal → attribution → action. " +
    "Names who is polluting, where, with what evidence, and what to do about it today.",
  keywords: ["air quality", "AQI", "pollution", "enforcement", "Delhi", "CAAQMS"],
  authors: [{ name: "AQ Intelligence Team" }],
  openGraph: {
    title: "AQ Intelligence Platform",
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
    <html lang="en" data-theme="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
