import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests talk to a real, separate database (travel_test), never the dev database.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://app@localhost:5432/travel_test',
      // Stand-in Duffel and Gemini servers, started by globalSetup.
      DUFFEL_BASE_URL: 'http://localhost:4010',
      DUFFEL_ACCESS_TOKEN: 'duffel_test_fake', // pragma: allowlist secret  gitleaks:allow
      GEMINI_BASE_URL: 'http://localhost:4020',
      GEMINI_API_KEY: 'fake-key-for-tests', // pragma: allowlist secret  gitleaks:allow
    },
    globalSetup: ['./src/test/globalSetup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
