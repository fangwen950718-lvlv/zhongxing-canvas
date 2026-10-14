import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: '.widget-build',
    emptyOutDir: true,
    assetsInlineLimit: 50_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/widget.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
