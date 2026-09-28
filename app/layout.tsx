import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloud Sculptor",
  description:
    "A contemplative browser game about sculpting volumetric clouds in a living sky. No score, no timer — only weather, light and time.",
  applicationName: "Cloud Sculptor",
  openGraph: {
    title: "Cloud Sculptor",
    description: "Sculpt volumetric clouds in a living sky. No score, no timer — only beauty.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#141c38",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden antialiased">{children}</body>
    </html>
  );
}
