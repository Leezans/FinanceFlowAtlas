import type { Plugin } from "vite";

/**
 * @vitejs/plugin-rsc 0.5.26 collects client assets before Vite 8's css-post
 * generateBundle hook removes CSS-only JavaScript chunks. The resulting RSC
 * manifest can preload a deleted chunk, preventing client hydration.
 *
 * Let Vite finish moving CSS dependencies to their importers first, then run
 * the original RSC collector against that final graph. Do not recreate empty
 * JavaScript files, remove manifest entries after generation, or modify CSS.
 * Keep this narrow compatibility fix until the pinned plugin orders its own
 * hook after CSS processing; the build verifier protects future upgrades.
 */
export function rscManifestAfterCss(): Plugin {
  return {
    name: "financeflowatlas:rsc-manifest-after-css",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      const manifestPlugin = config.plugins.find(
        (plugin) => plugin.name === "rsc:virtual:vite-rsc/assets-manifest",
      );
      const hook = manifestPlugin?.generateBundle;
      if (!manifestPlugin || !hook) {
        throw new Error("RSC asset manifest hook changed; review the CSS ordering compatibility fix.");
      }
      manifestPlugin.generateBundle = typeof hook === "function"
        ? { order: "post", handler: hook }
        : { ...hook, order: "post" };
    },
  };
}
