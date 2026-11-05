import React from "react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", background: "#07111b", color: "#d9e7ec", padding: "clamp(24px, 7vw, 80px)", display: "grid", placeItems: "center" }}>
      <section style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ color: "#92aabd", letterSpacing: ".1em" }}>FINANCE FLOW ATLAS · 404</p>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 42px)" }}>这个地址没有对应页面</h1>
        <p style={{ color: "#a9bfcb", lineHeight: 1.8 }}>链接可能多带了括号或文字，也可能已过期。请从下面的入口继续。</p>
        <nav aria-label="可用页面" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
          <Link href="/markets" style={linkStyle}>全球市场地图 →</Link>
          <Link href="/ashare" style={linkStyle}>A 股行业与个股 →</Link>
          <Link href="/" style={linkStyle}>美国 TIC 补充层 →</Link>
        </nav>
      </section>
    </main>
  );
}

const linkStyle = { color: "#bde3ff", background: "#152b3c", border: "1px solid #35566d", borderRadius: 8, padding: "12px 16px", textDecoration: "none" };
