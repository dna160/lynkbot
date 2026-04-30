import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // conversation.service.test.ts requires @lynkbot/ai + @lynkbot/pantheon which are
    // not built in the Docker test image (pre-existing limitation — do not fix here).
    exclude: [
      '**/node_modules/**',
      '**/conversation.service.test.ts',
    ],
  },
});
