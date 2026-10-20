import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      // ゲーム本編と、相場データのモーショングラフィックス。パスは root からの相対。
      input: {
        main: 'index.html',
        motion: 'motion/index.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
