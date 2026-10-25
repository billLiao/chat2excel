import { defineConfig } from 'vitest/config';

/**
 * Tests run in a plain Node environment. The application Vite config includes
 * the Electron renderer polyfills, which must not leak into main-process tests.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
