import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// These local datasets and generated trees can contain millions of files.
// Chokidar does not use .gitignore; scanning them can starve API requests.
const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));
const ignoredWatchRoots = [
  ".cache",
  ".playwright-cli",
  "build",
  "data",
  "dist",
  "refs",
  "release",
  "src-tauri/target",
  "src-tauri/gen",
  "test-results",
  "playwright-report",
  "tools/PotreeConverter_2.1.5_x64_windows",
].map((directory) => path.resolve(workspaceRoot, directory).replaceAll("\\", "/"));

export default defineConfig({
  server: {
    watch: {
      ignored: (file) => {
        const normalized = file.replaceAll("\\", "/");
        return ignoredWatchRoots.some(
          (directory) =>
            normalized === directory || normalized.startsWith(directory + "/"),
        );
      },
    },
  },
  plugins: [
    {
      name: "supersplat-svg-data",
      enforce: "pre",
      async load(id) {
        if (
          id.replaceAll("\\", "/").includes("/vendor/supersplat/") &&
          id.endsWith(".svg")
        )
          return `export default ${JSON.stringify("data:image/svg+xml," + encodeURIComponent(await readFile(id, "utf8")))};`;
      },
    },
  ],
  css: {
    preprocessorOptions: {
      scss: { loadPaths: [path.resolve("node_modules/@playcanvas/pcui/dist")] },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], react: ["react", "react-dom"] },
      },
    },
  },
});
