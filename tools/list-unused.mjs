#!/usr/bin/env node
import ts from 'typescript';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

function loadTsConfig(tsconfigPath) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    const msg = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');
    throw new Error(`Failed to read tsconfig: ${msg}`);
  }
  const configHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    configHost,
    path.dirname(tsconfigPath)
  );
  return parsed;
}

function formatDiagnostic(diag) {
  const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
  const file = diag.file?.fileName;
  if (file && typeof diag.start === 'number') {
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    return `${file}:${line + 1}:${character + 1} - ${message}`;
  }
  return message;
}

function isUnusedDiagnostic(diag) {
  // Filter by known unused-related diagnostics codes and message fragments.
  const unusedCodes = new Set([
    6133, // '<name>' is declared but its value is never read.
    6196, // 'All imports in import declaration are unused.'
    6192, // Probably unused import-related (varies by TS version)
    6198, // Probably unused import-related (varies by TS version)
    7027, // Unused label
  ]);
  const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n').toLowerCase();
  const fragments = [
    'is declared but its value is never read',
    'assigned a value but never used',
    'all imports in import declaration are unused',
    'is never used',
    'never read',
    'unused',
  ];
  return unusedCodes.has(diag.code) || fragments.some(f => message.includes(f));
}

async function main() {
  const cwd = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(cwd, '..');
  const tsconfigPath = path.resolve(projectRoot, 'tsconfig.json');

  if (!fs.existsSync(tsconfigPath)) {
    console.error('tsconfig.json not found.');
    process.exit(2);
  }

  const parsed = loadTsConfig(tsconfigPath);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  const unusedDiagnostics = allDiagnostics.filter(isUnusedDiagnostic);

  if (unusedDiagnostics.length === 0) {
    console.log('No unused variables/functions/classes found.');
    return;
  }

  // Group by file for nicer output
  const byFile = new Map();
  for (const d of unusedDiagnostics) {
    const file = d.file?.fileName ?? '<no-file>';
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(d);
  }

  for (const [file, diags] of [...byFile.entries()].sort()) {
    console.log(file);
    for (const d of diags) {
      console.log('  - ' + formatDiagnostic(d));
    }
  }

  // Non-zero exit so CI can fail if desired
  process.exitCode = 1;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

