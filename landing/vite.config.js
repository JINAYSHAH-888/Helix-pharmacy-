import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Built into landing/dist and served by the Java gateway at /landing/dist/.
// In dev, /api is proxied to the gateway so live counts work.
export default defineConfig({
  base: './',
  plugins: [react()],
  // pre-bundle React together with motion so there is exactly one React instance
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'motion/react', 'three', 'gsap', 'ogl'] },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    fs: { allow: ['..'] },          // tokens/ and engine/ live in the parent project
    proxy: { '/api': 'http://localhost:8080' },
  },
})
