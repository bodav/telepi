import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli.tsx' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
  external: ['@mtcute/node', 'better-sqlite3'],
})
