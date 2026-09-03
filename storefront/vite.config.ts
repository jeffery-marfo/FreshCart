import { defineConfig } from "vite";

// In dev, proxy /api to the checkout-api so the browser never needs CORS
// configured and the code never has to care whether it's running locally,
// in a container, or behind a real load balancer later.
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  }
});
