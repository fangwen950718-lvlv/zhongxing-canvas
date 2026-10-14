import { defineConfig } from 'vite';
import { imageJobsPlugin } from './scripts/image-jobs.mjs';
import { briefJobsPlugin } from './scripts/brief-jobs.mjs';

export default defineConfig({
  plugins: [imageJobsPlugin(), briefJobsPlugin()],
  // The generated Codex widget is a self-contained HTML artifact, not a dev entry.
  // Restrict dependency discovery so Vite does not try to scan its 8 MB inline module.
  optimizeDeps: {
    entries: ['index.html'],
  },
});
