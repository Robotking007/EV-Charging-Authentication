import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    // @web3auth/* pulls in browserify-style crypto/mnemonic libs that
    // expect Node's Buffer/process globals, which don't exist in the
    // browser and Vite does not polyfill on its own.
    nodePolyfills({ include: ["buffer", "process"] })
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api/trust-engine": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/trust-engine/, "")
      }
    }
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true }
});
