import { defineConfig } from 'vitest/config';

// worker/worker.test.mjs is a standalone node script (npm run test:worker) that
// calls process.exit — keep it out of vitest's own collection.
export default defineConfig({
  test: {
    // worker/worker.test.mjs (the existing plain-node offline test) keeps its
    // .mjs extension specifically so this pattern never picks it up.
    include: ['src/**/*.{test,spec}.{js,jsx}', 'worker/**/*.{test,spec}.js'],
  },
});
