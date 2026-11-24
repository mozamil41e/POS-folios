import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the UI into dist/, which server.ts serves in production.
// AI Studio leftovers (asset-copy plugin, DISABLE_HMR, the unused '@' alias)
// were removed in R1.11.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
