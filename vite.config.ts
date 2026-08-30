import { defineConfig } from 'vite';

export default defineConfig({
  base: '/portfolio-dashboard/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
