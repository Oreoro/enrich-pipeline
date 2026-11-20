import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/env.mjs';
import { mapPool } from '../src/cli.mjs';

test('loadEnv reads KEY=value, strips quotes and skips comments', () => {
	const file = join(mkdtempSync(join(tmpdir(), 'enrich-')), '.env');
	writeFileSync(file, '# comment\n\nFOO=bar\nQUOTED="has spaces"\nSINGLE=\'single\'\nEMPTY=\n');
	loadEnv(file);
	assert.equal(process.env.FOO, 'bar');
	assert.equal(process.env.QUOTED, 'has spaces');
	assert.equal(process.env.SINGLE, 'single');
	assert.equal(process.env.EMPTY, '');
});

test('loadEnv never overrides a value already in the environment', () => {
	const file = join(mkdtempSync(join(tmpdir(), 'enrich-')), '.env');
	writeFileSync(file, 'ALREADY=from-file\n');
	process.env.ALREADY = 'from-env';
	loadEnv(file);
	assert.equal(process.env.ALREADY, 'from-env');
});

test('loadEnv tolerates a missing file', () => {
	assert.doesNotThrow(() => loadEnv('/nonexistent/.env'));
});

test('mapPool preserves order and never exceeds the limit', async () => {
	let inFlight = 0;
	let peak = 0;
	const items = [10, 20, 30, 40, 50, 60];
	const results = await mapPool(items, 2, async (item) => {
		inFlight++;
		peak = Math.max(peak, inFlight);
		await new Promise((resolve) => setTimeout(resolve, 5));
		inFlight--;
		return item * 2;
	});
	assert.deepEqual(results, [20, 40, 60, 80, 100, 120]);
	assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test('mapPool handles an empty list and a limit above the item count', async () => {
	assert.deepEqual(await mapPool([], 4, async (item) => item), []);
	assert.deepEqual(await mapPool([1, 2], 99, async (item) => item + 1), [2, 3]);
});
