import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: { fileParallelism: false, testTimeout: 20000, hookTimeout: 30000 },
});
