import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

const apiPort = process.env.API_PORT ?? "3001";

export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  plugins: [vue()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true },
});
