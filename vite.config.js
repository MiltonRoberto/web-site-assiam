import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: "./frontend",
  publicDir: "./public",
  plugins: [react()],
  build: {
    outDir: path.resolve("./dist"),
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333"
    }
  }
});
