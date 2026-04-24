import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },

  // 🔥 Dev server (local + Render compatibility)
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
    allowedHosts: ["autoreel-1-9oq1.onrender.com"],
    hmr: process.env.DISABLE_HMR !== "true",
  },

  // 🔥 Preview server (Render pe ye run hota hai)
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 4173,
    allowedHosts: ["autoreel-1-9oq1.onrender.com"],
  },
});