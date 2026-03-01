import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
