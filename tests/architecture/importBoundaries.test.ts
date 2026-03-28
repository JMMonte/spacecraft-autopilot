import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = process.cwd();

function collectFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

test('simulation layers do not import state modules directly', () => {
  const restrictedRoots = [
    'src/core',
    'src/controllers',
    'src/scenes',
    'src/physics',
    'src/objects',
    'src/helpers',
    'src/workers',
  ];

  const offenders: string[] = [];
  for (const relRoot of restrictedRoots) {
    const files = collectFiles(path.join(ROOT, relRoot));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const hasStateImport = /from\s+['"][^'"]*\/state\/[^'"]*['"]/.test(text);
      if (hasStateImport) {
        offenders.push(path.relative(ROOT, file));
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Forbidden direct imports to src/state/* found:\n${offenders.join('\n')}`
  );
});

test('runtime state module is controller-agnostic', () => {
  const appStatePath = path.join(ROOT, 'src/state/appState.ts');
  const text = fs.readFileSync(appStatePath, 'utf8');

  assert.equal(
    text.includes('/controllers/'),
    false,
    'src/state/appState.ts must not depend on controller modules'
  );
});

test('controllers do not import from scenes layer', () => {
  const files = collectFiles(path.join(ROOT, 'src/controllers'));
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const hasScenesImport = /from\s+['"][^'"]*\/scenes\/[^'"]*['"]/.test(text);
    if (hasScenesImport) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Forbidden direct imports from src/scenes/* in controllers:\n${offenders.join('\n')}`
  );
});
