// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NotFound from "../app/not-found";

afterEach(cleanup);

describe("missing page recovery", () => {
  it("offers only the three implemented same-origin entry points", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("这个地址没有对应页面");
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/markets", "/ashare", "/"]);
    expect(screen.getByRole("navigation", { name: "可用页面" })).toBeTruthy();
  });
});
