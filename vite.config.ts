import { defineConfig } from 'vite';

// The extension is just its new tab page: built into dist/ with relative paths, ready to load
// unpacked (chrome://extensions) or zip for the Chrome Web Store. public/manifest.json is copied as is.
// With --mode pages (npm run build:pages), the wallpaper instead (index.html), into pages/, for
// GitHub Pages. With --mode lib (npm run build:lib), the package (src/index.ts), into lib/, its
// shaders inlined, for npm.
export default defineConfig(({ mode }) => mode === 'lib' ? {
  build: {
    lib: { entry: 'src/index.ts', formats: ['es' as const], fileName: 'koipond' },
    outDir: 'lib',
    target: 'es2022',
    copyPublicDir: false,
  },
} : {
  base: './',
  build: {
    target: 'es2022', // top-level await, for the settings
    modulePreload: { polyfill: false }, // nothing inline: extension pages forbid inline scripts
    rollupOptions: { input: mode === 'pages' ? 'index.html' : 'newtab.html' },
    outDir: mode === 'pages' ? 'pages' : 'dist',
  },
});
