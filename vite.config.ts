import { defineConfig } from "vite";

export default defineConfig({
  base: "/multiplayer-car-game/",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
