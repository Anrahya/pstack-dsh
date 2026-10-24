import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  platform: 'node',
  format: 'esm',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: true,
  outDir: 'lib',
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
})
