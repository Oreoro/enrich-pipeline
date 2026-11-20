import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, fromCsv } from '../src/csv.mjs';

test('quotes values with commas, quotes and newlines', () => {
	const csv = toCsv([{ a: 'Hello, world', b: 'He said "hi"', c: 'line1\nline2' }], [
		{ header: 'A', value: (row) => row.a },
		{ header: 'B', value: (row) => row.b },
		{ header: 'C', value: (row) => row.c },
	]);
	assert.equal(csv, 'A,B,C\n"Hello, world","He said ""hi""","line1\nline2"\n');
});

test('writes empty cells for null, undefined and arrays join with semicolons', () => {
	const csv = toCsv([{ a: null, b: undefined, c: ['x', 'y'] }], [
		{ header: 'A', value: (row) => row.a },
		{ header: 'B', value: (row) => row.b },
		{ header: 'C', value: (row) => row.c },
	]);
	assert.equal(csv, 'A,B,C\n,,x; y\n');
});

test('parses quoted fields, embedded commas, newlines and doubled quotes', () => {
	const rows = fromCsv('Company,Domain,Note\n"Acme, Inc.",acme.com,"He said ""hi""\nsecond line"\n');
	assert.deepEqual(rows, [{ Company: 'Acme, Inc.', Domain: 'acme.com', Note: 'He said "hi"\nsecond line' }]);
});

test('round-trips values that need quoting', () => {
	const source = [{ a: 'comma, inside', b: 'quote " inside', c: 'new\nline' }];
	const columns = [
		{ header: 'A', value: (row) => row.a },
		{ header: 'B', value: (row) => row.b },
		{ header: 'C', value: (row) => row.c },
	];
	assert.deepEqual(fromCsv(toCsv(source, columns)), [{ A: 'comma, inside', B: 'quote " inside', C: 'new\nline' }]);
});

test('ignores blank lines and trailing newline', () => {
	assert.deepEqual(fromCsv('A,B\n1,2\n\n'), [{ A: '1', B: '2' }]);
	assert.deepEqual(fromCsv(''), []);
});
