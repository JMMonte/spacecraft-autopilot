import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as ts from 'typescript';

const ROOT = process.cwd();
type RestrictedNamespace = 'state' | 'scenes' | 'controllers';

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

function collectModuleSpecifiers(fileText: string): string[] {
  const sourceFile = ts.createSourceFile('boundary-check.ts', fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        specifiers.push(moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const arg = node.arguments[0];
      if (node.arguments.length === 1 && ts.isStringLiteral(arg)) {
        if (expr.kind === ts.SyntaxKind.ImportKeyword) {
          specifiers.push(arg.text);
        } else if (ts.isIdentifier(expr) && expr.text === 'require') {
          specifiers.push(arg.text);
        }
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
        specifiers.push(ref.expression.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

function hasForbiddenNamespace(specifier: string, namespace: RestrictedNamespace): boolean {
  const pattern = new RegExp(`(^|/)@?${namespace}(/|$)`);
  return pattern.test(specifier);
}

function findForbiddenSpecifiers(fileText: string, namespaces: RestrictedNamespace[]): string[] {
  return collectModuleSpecifiers(fileText).filter((specifier) =>
    namespaces.some((namespace) => hasForbiddenNamespace(specifier, namespace))
  );
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
      const forbidden = findForbiddenSpecifiers(text, ['state']);
      if (forbidden.length > 0) {
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

test('alias imports to forbidden layers are detected', () => {
  const text = [
    "import { foo } from '@state/store';",
    "export { bar } from '@scenes/sceneHelpers';",
    "const mod = await import('../src/state/appState');",
    "const req = require('@state/domainStateBridge');",
  ].join('\n');

  assert.deepEqual(findForbiddenSpecifiers(text, ['state', 'scenes']).sort(), [
    '../src/state/appState',
    '@scenes/sceneHelpers',
    '@state/domainStateBridge',
    '@state/store',
  ].sort());
});

test('runtime state module is controller-agnostic', () => {
  const appStatePath = path.join(ROOT, 'src/state/appState.ts');
  const text = fs.readFileSync(appStatePath, 'utf8');
  const forbidden = findForbiddenSpecifiers(text, ['controllers']);

  assert.equal(
    forbidden.length,
    0,
    `src/state/appState.ts must not depend on controller modules:\n${forbidden.join('\n')}`
  );
});

test('controllers do not import from scenes layer', () => {
  const files = collectFiles(path.join(ROOT, 'src/controllers'));
  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const forbidden = findForbiddenSpecifiers(text, ['scenes']);
    if (forbidden.length > 0) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Forbidden direct imports from src/scenes/* in controllers:\n${offenders.join('\n')}`
  );
});
