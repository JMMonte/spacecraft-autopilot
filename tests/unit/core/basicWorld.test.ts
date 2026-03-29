import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpacecraftListNotifier } from '../../../src/core/spacecraftListNotifier';
import { removeSpacecraftAndController } from '../../../src/core/spacecraftLifecycle';

test('removeSpacecraftAndController removes the paired controller and runs cleanup', () => {
  const cleanupCalls: string[] = [];

  const spacecraft = {
    uuid: 'craft-1',
    cleanup: () => {
      cleanupCalls.push('spacecraft');
    },
  } as any;

  const controller = {
    getSpacecraft: () => spacecraft,
    cleanup: () => {
      cleanupCalls.push('controller');
    },
  } as any;

  const spacecrafts = [spacecraft];
  const controllers = [controller];

  const removed = removeSpacecraftAndController(spacecrafts, controllers, spacecraft, () => {
    cleanupCalls.push('spacecraft');
  });

  assert.equal(removed, true);
  assert.equal(spacecrafts.length, 0);
  assert.equal(controllers.length, 0);
  assert.deepEqual(cleanupCalls, ['spacecraft']);
});

test('removeSpacecraftAndController leaves arrays untouched when the controller pairing is missing', () => {
  const spacecraft = { uuid: 'craft-1' } as any;
  const otherSpacecraft = { uuid: 'craft-2' } as any;
  const otherController = {
    getSpacecraft: () => otherSpacecraft,
  } as any;

  const spacecrafts = [spacecraft, otherSpacecraft];
  const controllers = [otherController];

  const removed = removeSpacecraftAndController(spacecrafts, controllers, spacecraft);

  assert.equal(removed, false);
  assert.deepEqual(spacecrafts, [spacecraft, otherSpacecraft]);
  assert.deepEqual(controllers, [otherController]);
});

test('SpacecraftListNotifier preserves later subscribers when a middle subscriber unsubscribes', () => {
  const notifier = new SpacecraftListNotifier();
  const versions: number[] = [];
  const calls: string[] = [];

  notifier.setVersionListener((version) => {
    versions.push(version);
  });

  const unsubscribeA = notifier.subscribe(() => calls.push('A'));
  const unsubscribeB = notifier.subscribe(() => calls.push('B'));
  const unsubscribeC = notifier.subscribe(() => calls.push('C'));

  notifier.emit();
  unsubscribeB();
  notifier.emit();
  unsubscribeA();
  unsubscribeC();
  notifier.emit();

  assert.deepEqual(versions, [1, 2, 3]);
  assert.deepEqual(calls, ['A', 'B', 'C', 'A', 'C']);
});
