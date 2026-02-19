import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

function runScript(scriptPath: string): string {
  try {
    return execFileSync('node', ['--import', 'tsx', scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err: any) {
    const stdout = err?.stdout ? String(err.stdout) : '';
    const stderr = err?.stderr ? String(err.stderr) : '';
    assert.fail(`Script failed: ${scriptPath}\n${stdout}\n${stderr}`);
  }
}

test('legacy autopilot script passes', () => {
  const output = runScript('tools/tests/autopilot.test.ts');
  assert.match(output, /All autopilot tests passed/);
});

test('legacy trajectory script passes', () => {
  const output = runScript('tools/tests/trajectory.test.ts');
  assert.match(output, /All trajectory planner tests passed/);
});
