
import path from "path"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"
import { componentTagger } from "lovable-tagger"

// https://vitejs/plugin-react/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
    host: "::",
  },
}))
