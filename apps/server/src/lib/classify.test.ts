import { test, expect } from 'bun:test';
import { languageOf, layerOf } from './classify';

test('languageOf maps by extension', () => {
  expect(languageOf('apps/web/App.tsx')).toBe('TypeScript');
  expect(languageOf('main.py')).toBe('Python');
  expect(languageOf('styles.css')).toBe('CSS');
  expect(languageOf('Dockerfile')).toBe('Docker');
  expect(languageOf('q.gql')).toBe('GraphQL');
});

test('languageOf falls back gracefully', () => {
  expect(languageOf('README')).toBe('Other');
  expect(languageOf('weird.xyz')).toBe('XYZ');
});

test('layerOf checks specific layers before broad ones', () => {
  expect(layerOf('db/0001_init.sql')).toBe('database');
  expect(layerOf('apps/server/src/db/schema.ts')).toBe('database'); // schema.ts wins over backend
  expect(layerOf('deploy/Caddyfile')).toBe('infra');
  expect(layerOf('docker-compose.yml')).toBe('infra');
  expect(layerOf('docs/guide.md')).toBe('docs');
  expect(layerOf('apps/web/components/Board.tsx')).toBe('frontend');
  expect(layerOf('apps/server/src/routes/api.ts')).toBe('backend');
  expect(layerOf('LICENSE')).toBe('other');
});
