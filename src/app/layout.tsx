import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CanonicalHostNotice } from "@/components/CanonicalHostNotice";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Binge",
  description: "Mobile-first web app",
  applicationName: "Binge",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Binge",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#16274a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex flex-col overflow-x-hidden bg-background text-foreground">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(1100px_circle_at_50%_-180px,rgba(96,165,250,0.055),transparent_68%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_14%_22%,rgba(99,102,241,0.07),transparent_64%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-black/35" />
        </div>
        <CanonicalHostNotice canonicalHost="binge-web-app.vercel.app" />
        {children}
      </body>
    </html>
  );
}
