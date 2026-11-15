import { defineConfig } from 'vite';

// The extension is just its new tab page: built into dist/ with relative paths, ready to load
// unpacked (chrome://extensions) or zip for the Chrome Web Store. public/manifest.json is copied as is.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', // top-level await, for the settings
    modulePreload: { polyfill: false }, // nothing inline: extension pages forbid inline scripts
    rollupOptions: { input: 'newtab.html' },
  },
});
