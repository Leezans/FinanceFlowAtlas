import type { Metadata } from "next";
import "./globals.css";
import MarketNavigation from "@/components/navigation/MarketNavigation";

export const metadata: Metadata = {
  title: "Finance Flow Atlas · 市场热力图与证据",
  description: "Explore A-share industry and stock heatmaps, a global market map, selected Kraken spot pairs, and monthly U.S. Treasury TIC evidence. Each source retains its own coverage, timing and meaning.",
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
    <html lang="zh-CN">
      <body className="antialiased"><MarketNavigation/>{children}</body>
    </html>
  );
}
