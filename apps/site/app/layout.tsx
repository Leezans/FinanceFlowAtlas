import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Flow Atlas · 股权证据",
  description: "Independent monthly U.S. Treasury TIC equity transactions with explicit source coverage and timing.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
