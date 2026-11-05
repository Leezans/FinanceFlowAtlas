import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import { rscManifestAfterCss } from "../scripts/vite/rsc-manifest-after-css";
import { verifyBuiltAssets } from "../scripts/verify-built-assets.mjs";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function configure(plugins: Plugin[]) {
  const hook = rscManifestAfterCss().configResolved;
  if (typeof hook !== "function") throw new Error("Expected configResolved handler");
  hook.call({} as never, { plugins } as unknown as ResolvedConfig);
}

describe("RSC asset collection after CSS pruning", () => {
  it("runs the original collector after CSS-only chunks are removed and CSS is transferred", () => {
    const bundle = new Map([
      ["page.js", { imports: ["styles-any-hash.js"], css: [] as string[] }],
      ["styles-any-hash.js", { imports: [], css: ["styles-any-hash.css"] }],
    ]);
    let collected: unknown;
    const context = { environment: { name: "client" } };
    const handler = function (this: unknown) {
      expect(this).toBe(context);
      collected = [...bundle];
    };
    const plugin: Plugin = { name: "rsc:virtual:vite-rsc/assets-manifest", generateBundle: handler };
    configure([plugin]);
    expect(plugin.generateBundle).toEqual({ order: "post", handler });
    const page = bundle.get("page.js")!;
    page.css.push(...bundle.get("styles-any-hash.js")!.css);
    page.imports = [];
    bundle.delete("styles-any-hash.js");
    handler.call(context);
    expect(collected).toEqual([["page.js", { imports: [], css: ["styles-any-hash.css"] }]]);
  });

  it("preserves upstream hook options and already-correct post ordering", () => {
    const handler = () => {};
    const plugin: Plugin = { name: "rsc:virtual:vite-rsc/assets-manifest", generateBundle: { order: "post", handler } };
    configure([plugin]);
    expect(plugin.generateBundle).toEqual({ order: "post", handler });
    expect(rscManifestAfterCss().apply).toBe("build");
  });

  it("fails closed if a dependency upgrade changes the expected hook", () => {
    expect(() => configure([])).toThrow("RSC asset manifest hook changed");
    expect(() => configure([{ name: "rsc:virtual:vite-rsc/assets-manifest" }])).toThrow("RSC asset manifest hook changed");
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "financeflowatlas-assets-"));
  temporary.push(root);
  const write = async (file: string, contents: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  };
  const manifest = {
    bootstrapScriptContent: 'import("/_next/static/chunks/bootstrap.js")',
    clientReferenceDeps: { page: { js: ["/_next/static/chunks/page.js"], css: ["/_next/static/css/shared.css"] } },
    serverResources: { layout: { js: [], css: ["/_next/static/css/layout.css"] } },
  };
  const writeRsc = async () => {
    for (const environment of ["server", "server/ssr"]) await write(`${environment}/__vite_rsc_assets_manifest.js`, `export default ${JSON.stringify(manifest)}`);
  };
  await writeRsc();
  const viteManifest = {
    bootstrap: { file: "_next/static/chunks/bootstrap.js", dynamicImports: ["page"] },
    page: { file: "_next/static/chunks/page.js", css: ["_next/static/css/shared.css"], assets: ["logo.svg"] },
  };
  const writeVite = () => write("client/.vite/manifest.json", JSON.stringify(viteManifest));
  await writeVite();
  await write("client/vinext-client-entry-manifest.json", JSON.stringify({ appBrowserEntry: "_next/static/chunks/bootstrap.js" }));
  for (const file of ["_next/static/chunks/bootstrap.js", "_next/static/chunks/page.js", "_next/static/css/shared.css", "_next/static/css/layout.css", "logo.svg"]) await write(`client/${file}`, "fixture");
  return { root, write, manifest, writeRsc, viteManifest, writeVite };
}

describe("built asset integrity", () => {
  it("checks both RSC manifests, shared CSS, bootstrap, Vite dynamic imports and media", async () => {
    const { root } = await fixture();
    expect(await verifyBuiltAssets(root)).toEqual({ assetCount: 5, rscManifestCount: 2, viteEntryCount: 2 });
  });

  it("rejects a dangling CSS-only JavaScript reference without depending on its hash", async () => {
    const { root, manifest, writeRsc } = await fixture();
    manifest.clientReferenceDeps.page.js.push("/_next/static/chunks/styles-new-content-hash.js");
    await writeRsc();
    await expect(verifyBuiltAssets(root)).rejects.toThrow("styles-new-content-hash.js");
  });

  it.each(["_next/static/css/shared.css", "_next/static/css/layout.css", "_next/static/chunks/bootstrap.js", "logo.svg"])("rejects a missing %s", async (reference) => {
    const { root } = await fixture();
    await rm(path.join(root, "client", reference));
    await expect(verifyBuiltAssets(root)).rejects.toThrow(reference);
  });

  it("rejects a missing Vite graph entry", async () => {
    const { root, viteManifest, writeVite } = await fixture();
    viteManifest.bootstrap.dynamicImports.push("missing-route");
    await writeVite();
    await expect(verifyBuiltAssets(root)).rejects.toThrow("Missing Vite dynamicImports entry missing-route");
  });

  it("rejects divergent manifests", async () => {
    const { root, manifest, write } = await fixture();
    manifest.bootstrapScriptContent = 'import("/other.js")';
    await write("server/ssr/__vite_rsc_assets_manifest.js", `export default ${JSON.stringify(manifest)}`);
    await expect(verifyBuiltAssets(root)).rejects.toThrow("RSC and SSR asset manifests disagree");
  });

  it.each(["clientReferenceDeps", "serverResources"])("rejects an array in RSC %s", async (key) => {
    const { root, manifest, write } = await fixture();
    await write("server/__vite_rsc_assets_manifest.js", `export default ${JSON.stringify({ ...manifest, [key]: [] })}`);
    await expect(verifyBuiltAssets(root)).rejects.toThrow("Invalid manifest object");
  });

  it.each([".vite/manifest.json", "vinext-client-entry-manifest.json"])("rejects an array in %s", async (name) => {
    const { root, write } = await fixture();
    await write(`client/${name}`, "[]");
    await expect(verifyBuiltAssets(root)).rejects.toThrow("Invalid manifest object");
  });

  it.each(["https://cdn.invalid/asset.js", "git+ssh://cdn.invalid/asset.js", "//cdn.invalid/asset.js"])("rejects external asset URL %s", async (reference) => {
    const { root, manifest, writeRsc } = await fixture();
    manifest.clientReferenceDeps.page.js.push(reference);
    await writeRsc();
    await expect(verifyBuiltAssets(root)).rejects.toThrow("Unsupported built asset reference");
  });

  it("rejects path traversal and executable manifest content", async () => {
    const { root, manifest, writeRsc, write } = await fixture();
    manifest.clientReferenceDeps.page.js.push("/../private.js");
    await writeRsc();
    await expect(verifyBuiltAssets(root)).rejects.toThrow("escapes client output");
    await write("server/__vite_rsc_assets_manifest.js", "export default globalThis.fetch('https://example.invalid')");
    await expect(verifyBuiltAssets(root)).rejects.toThrow();
  });
});
