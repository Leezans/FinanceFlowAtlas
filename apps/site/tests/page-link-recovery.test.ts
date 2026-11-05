import { describe, expect, it } from "vitest";
import { recoverPageLink } from "../lib/page-link-recovery";

const origin = "https://example.test";

describe("copied page link recovery", () => {
  it.each([
    ["/markets)。可以从地图选择国家，中国可进入", "/markets"],
    ["/markets%29%E3%80%82more", "/markets"],
    ["/markets）后续文字", "/markets"],
    ["/ashare)", "/ashare"],
    ["/ashare)%2F%2Fevil.test?return_to=https://evil.test", "/ashare"],
  ])("recovers %s to the fixed local page", (path, expected) => {
    const response = recoverPageLink(new Request(origin + path));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe(expected);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["/markets", "/markets/", "/markets?country=CHN", "/ashare", "/marketspace)", "/markets/unknown)", "/api/v1/ashare/snapshot)", "/signin-with-chatgpt)", "/unknown)", "/markets%2529text", "/markets)%ZZ"])("preserves normal routing for %s", path => {
    expect(recoverPageLink(new Request(origin + path))).toBeNull();
  });

  it("allows HEAD but never redirects a write", () => {
    expect(recoverPageLink(new Request(origin + "/markets)", { method: "HEAD" }))?.status).toBe(307);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(recoverPageLink(new Request(origin + "/markets)", { method }))).toBeNull();
    }
  });
});
