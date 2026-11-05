import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RSC_MANIFEST = "__vite_rsc_assets_manifest.js";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function record(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid manifest object in ${source}`);
  }
  return value;
}

export async function verifyBuiltAssets(distDirectory) {
  const dist = path.resolve(distDirectory);
  const client = path.join(dist, "client");
  const references = new Map();
  function asset(value, source) {
    if (typeof value !== "string" || !value || /[?#\\]|^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
      throw new Error(`Unsupported built asset reference in ${source}: ${JSON.stringify(value)}`);
    }
    const relative = value.replace(/^\//, "");
    const resolved = path.resolve(client, relative);
    if (!resolved.startsWith(`${client}${path.sep}`)) {
      throw new Error(`Built asset escapes client output in ${source}: ${value}`);
    }
    const sources = references.get(relative) ?? new Set();
    sources.add(source);
    references.set(relative, sources);
  }
  function dependencies(value, source) {
    if (!value || !Array.isArray(value.js) || !Array.isArray(value.css)) {
      throw new Error(`Invalid asset dependencies in ${source}`);
    }
    for (const reference of [...value.js, ...value.css]) asset(reference, source);
  }

  let canonicalManifest;
  for (const environment of ["server", "server/ssr"]) {
    const source = `${environment}/${RSC_MANIFEST}`;
    const code = await readFile(path.join(dist, source), "utf8");
    // This project's pinned RSC plugin writes plain JSON, not executable code.
    // Fail closed if the serialization contract changes instead of evaluating it.
    if (!code.startsWith("export default ")) throw new Error(`Invalid RSC manifest: ${source}`);
    const manifest = record(JSON.parse(code.slice("export default ".length).trim().replace(/;$/, "")), source);
    const serialized = JSON.stringify(manifest);
    if (canonicalManifest && canonicalManifest !== serialized) {
      throw new Error("RSC and SSR asset manifests disagree");
    }
    canonicalManifest = serialized;
    for (const key of ["clientReferenceDeps", "serverResources"]) {
      for (const [id, deps] of Object.entries(record(manifest[key], `${source}:${key}`))) dependencies(deps, `${source}:${key}:${id}`);
    }
    const bootstrap = /^import\(("(?:[^"\\]|\\.)*")\);?$/.exec(manifest.bootstrapScriptContent);
    if (!bootstrap) throw new Error(`Unsupported RSC bootstrap in ${source}`);
    asset(JSON.parse(bootstrap[1]), `${source}:bootstrapScriptContent`);
  }

  const viteManifest = record(await readJson(path.join(client, ".vite/manifest.json")), "client/.vite/manifest.json");
  for (const [id, entry] of Object.entries(viteManifest)) {
    const source = `client/.vite/manifest.json:${id}`;
    record(entry, source);
    asset(entry.file, source);
    for (const key of ["css", "assets"]) for (const reference of entry[key] ?? []) asset(reference, source);
    for (const key of ["imports", "dynamicImports"]) {
      for (const reference of entry[key] ?? []) {
        if (!Object.hasOwn(viteManifest, reference)) throw new Error(`Missing Vite ${key} entry ${reference} in ${source}`);
      }
    }
  }
  const entries = record(await readJson(path.join(client, "vinext-client-entry-manifest.json")), "vinext-client-entry-manifest.json");
  if (!entries.appBrowserEntry) throw new Error("Missing appBrowserEntry in vinext client entry manifest");
  for (const [name, reference] of Object.entries(entries)) asset(reference, `vinext-client-entry-manifest.json:${name}`);

  const missing = [];
  for (const [reference, sources] of references) {
    try {
      if (!(await stat(path.join(client, reference))).isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(`${reference} (referenced by ${[...sources].join(", ")})`);
    }
  }
  if (missing.length) throw new Error(`Missing built client assets (${missing.length}):\n${missing.join("\n")}`);
  return { assetCount: references.size, rscManifestCount: 2, viteEntryCount: Object.keys(viteManifest).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
  const result = await verifyBuiltAssets(dist);
  console.log(`Verified ${result.assetCount} client assets across both RSC manifests, ${result.viteEntryCount} Vite entries and the client bootstrap.`);
}
