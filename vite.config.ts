import react from "@vitejs/plugin-react";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const MAX_TAKE_BYTES = 300 * 1024 * 1024;

/** Development only: takes posted to /__takes/<name>.wav|.json are written to local-inputs/takes/ (git-ignored). */
function saveTakes(): Plugin {
  return {
    name: "phrasepath-save-takes",
    configureServer(server) {
      server.middlewares.use("/__takes", async (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "");
        if (req.method !== "POST" || !/^[\w-]+\.(wav|json)$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > MAX_TAKE_BYTES) {
            res.statusCode = 413;
            res.end();
            return;
          }
          chunks.push(chunk as Buffer);
        }
        const dir = resolve(server.config.root, "local-inputs/takes");
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, name), Buffer.concat(chunks));
        res.statusCode = 204;
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveTakes()],
  // Spark calls go to the local Worker (`npm run server`), which holds the key and the ledger.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  build: {
    // Audio worklets must load from a real file; some browsers refuse a data: URL.
    assetsInlineLimit: (file) => (file.endsWith("-worklet.js") ? false : undefined),
  },
});
