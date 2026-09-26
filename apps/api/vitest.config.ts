import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests talk to a real, separate database (travel_test), never the dev database.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test',
    },
    globalSetup: ['./src/test/globalSetup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
