import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fromWebRoot = (path: string) => new URL(`../${path}`, import.meta.url);

describe("mobile storefront menu", () => {
  it("owns readable colors at the top and after the header changes for scroll", async () => {
    const css = await readFile(fromWebRoot("app/globals.css"), "utf8");
    expect(css).toMatch(/\.mobile-nav\{[^}]*background:var\(--milk\)[^}]*color:var\(--ink\)/);
    expect(css).toMatch(/\.mobile-nav a\{[^}]*color:var\(--ink\)/);
    expect(css).toMatch(/\.header-over-hero \.mobile-nav[^}]*color:var\(--ink\)/);
  });

  it.each([360, 390, 430])("uses a fixed safe-area drawer at %ipx", async () => {
    const css = await readFile(fromWebRoot("app/globals.css"), "utf8");
    expect(css).toMatch(/@media\(max-width:900px\)[\s\S]*\.mobile-nav\{[^}]*position:fixed/);
    expect(css).toMatch(/height:100dvh/);
    expect(css).toMatch(/overflow-y:auto/);
    expect(css).toMatch(/env\(safe-area-inset-top\)/);
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("closes through the drawer control and restores page scrolling", async () => {
    const component = await readFile(fromWebRoot("components/header.tsx"), "utf8");
    expect(component).toContain('document.body.classList.add("mobile-drawer-open")');
    expect(component).toContain('document.body.classList.remove("mobile-drawer-open")');
    expect(component).toContain('aria-label="Закрыть меню"');
  });
});
