import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaFor, systemFor, CELL_TYPES } from '../src/schema.mjs';

test('every cell schema is strict and requires value, confidence and sources', () => {
	for (const type of CELL_TYPES) {
		const schema = schemaFor(type);
		assert.equal(schema.type, 'object');
		assert.equal(schema.additionalProperties, false);
		assert.deepEqual(schema.required, ['value', 'confidence', 'sources']);
		assert.equal(schema.properties.confidence.minimum, 0);
		assert.equal(schema.properties.confidence.maximum, 1);
	}
});

test('value type follows the column type and is always nullable', () => {
	assert.deepEqual(schemaFor('number').properties.value.type, ['number', 'null']);
	assert.deepEqual(schemaFor('boolean').properties.value.type, ['boolean', 'null']);
	assert.deepEqual(schemaFor('string').properties.value.type, ['string', 'null']);
	assert.deepEqual(schemaFor('list').properties.value, { type: ['array', 'null'], items: { type: 'string' }, description: schemaFor('list').properties.value.description });
});

test('an unknown type falls back to string instead of emitting a broken schema', () => {
	assert.deepEqual(schemaFor('nope').properties.value.type, ['string', 'null']);
	assert.deepEqual(schemaFor().properties.value.type, ['string', 'null']);
});

test('the system prompt carries the answer shape and the no-invention rule', () => {
	for (const type of CELL_TYPES) {
		const system = systemFor({ type });
		assert.match(system, /Never invent facts/);
		assert.match(system, /Return null when the answer cannot be established/);
	}
	assert.match(systemFor({ type: 'boolean' }), /Answer true or false/);
	assert.match(systemFor({ type: 'number' }), /single number/);
	assert.match(systemFor({ type: 'list' }), /list of strings/);
	assert.match(systemFor({}), /short, specific value/);
});
