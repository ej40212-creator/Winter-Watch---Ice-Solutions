import type { Metadata } from "next";
import "./globals.css";

// Public origin is a deployment decision. The original ChatGPT Sites URL is not reused.
const pilotOrigin = process.env.PILOT_PUBLIC_ORIGIN || "http://127.0.0.1:5173";

export const metadata: Metadata = {
  title: "Winter Watch | Ice Solutions",
  description: "Private pilot. Snow and estimated surface-icing outlook up to one week for supplied Ice Solutions sites.",
  metadataBase: new URL(pilotOrigin),
  openGraph: {
    type: "website",
    url: pilotOrigin,
    siteName: "Ice Solutions Winter Watch",
    title: "Winter Watch | Ice Solutions",
    description: "Private pilot for snow and ice outlooks, live radar, and site-level weather intelligence.",
    images: [{
      url: "/winter-watch-share-v1.png",
      width: 1734,
      height: 907,
      type: "image/png",
      alt: "Ice Solutions Winter Watch — Stay ahead of winter. Snow and ice outlook, live radar, and site intelligence.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Winter Watch | Ice Solutions",
    description: "Private pilot for snow and ice outlooks, live radar, and site-level weather intelligence.",
    images: ["/winter-watch-share-v1.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
