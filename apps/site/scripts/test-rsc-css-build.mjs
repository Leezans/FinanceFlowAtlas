/** Regression reproduction with the real pinned Vite/RSC compiler. No network. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "vite";

const project = fileURLToPath(new URL("..", import.meta.url));
await mkdir(path.join(project, ".sites-runtime"), { recursive: true });
const root = await mkdtemp(path.join(project, ".sites-runtime/rsc-css-regression-"));
try {
  const files = {
    "client-a.js": "'use client'; import './shared.css'; export const A = () => 'A';",
    "client-b.js": "'use client'; import './shared.css'; export const B = () => 'B';",
    "shared.css": ".shared { color: red }",
    "rsc.js": "export { A } from './client-a.js'; export { B } from './client-b.js';",
    "ssr.js": "export default 'ssr';",
    "client.js": "import { createFromReadableStream } from '@vitejs/plugin-rsc/browser'; globalThis.decode = createFromReadableStream;",
  };
  await Promise.all(Object.entries(files).map(([name, source]) => writeFile(path.join(root, name), source)));
  const results = [];
  for (const fixed of [false, true]) {
    const label = fixed ? "fixed" : "baseline";
    const configFile = path.join(root, `vite.${label}.config.mts`);
    await writeFile(configFile, `
      import rsc from '@vitejs/plugin-rsc';
      import { rscManifestAfterCss } from '../../scripts/vite/rsc-manifest-after-css.ts';
      export default { plugins: [rsc(), ${fixed ? "rscManifestAfterCss()" : ""}] };
    `);
    const builder = await createBuilder({
      configFile,
      root,
      logLevel: "error",
      environments: Object.fromEntries(["rsc", "ssr", "client"].map((name) => [name, {
        build: {
          outDir: `${label}/${name}`,
          rolldownOptions: {
            input: { index: path.join(root, `${name}.js`) },
            // Force a shared CSS-only chunk deterministically. The production
            // graph produces the same chunk through its normal graph splitting.
            output: name === "client" ? { codeSplitting: { groups: [{ name: "styles", test: /shared\.css$/ }] } } : {},
          },
        },
      }])),
    });
    await builder.buildApp();
    const manifestSource = await readFile(path.join(root, label, "rsc/__vite_rsc_assets_manifest.js"), "utf8");
    const manifest = JSON.parse(manifestSource.slice("export default ".length));
    assert.equal(Object.keys(manifest.clientReferenceDeps).length, 2);
    const js = [...new Set(Object.values(manifest.clientReferenceDeps).flatMap((deps) => deps.js))];
    const css = [...new Set(Object.values(manifest.clientReferenceDeps).flatMap((deps) => deps.css))];
    const missingJs = [];
    for (const reference of js) {
      if (!(await stat(path.join(root, label, "client", reference)).catch(() => null))?.isFile()) missingJs.push(reference);
    }
    for (const reference of css) assert.ok((await stat(path.join(root, label, "client", reference))).isFile());
    assert.equal(css.length, 1, "The shared stylesheet must remain loaded");
    results.push({ js, css, missingJs });
  }
  assert.equal(results[0].missingJs.length, 1, "The pinned unfixed compiler must reproduce its deleted CSS-only JS reference");
  assert.deepEqual(results[1].missingJs, [], "The fixed manifest must reference only emitted JavaScript");
  assert.deepEqual(results[1].css, results[0].css, "The fix must preserve the same real stylesheet");
  assert.equal(results[1].js.length, results[0].js.length - 1);
  console.log("PASS actual Vite/RSC build: baseline references one deleted CSS-only JS chunk; corrected hook emits no dangling reference and preserves CSS.");
} finally {
  await rm(root, { recursive: true, force: true });
}
