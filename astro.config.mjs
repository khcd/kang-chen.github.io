// astro.config.mjs
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kang.fyi',
  base: '/',
  outDir: './dist',
  publicDir: './public',
  server: {
    port: 3000,
    host: true
  },
  build: {
    format: 'file'
  }
});