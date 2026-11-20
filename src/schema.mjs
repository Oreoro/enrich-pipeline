/** The JSON schema handed to the model for one cell. Strict, so the endpoint must support `json_schema`. */

const VALUE_SCHEMAS = {
	string: { type: ['string', 'null'] },
	number: { type: ['number', 'null'] },
	boolean: { type: ['boolean', 'null'] },
	list: { type: ['array', 'null'], items: { type: 'string' } },
};

export const CELL_TYPES = Object.keys(VALUE_SCHEMAS);

export function schemaFor(type = 'string') {
	const value = VALUE_SCHEMAS[type] ?? VALUE_SCHEMAS.string;
	return {
		type: 'object',
		properties: {
			value: { ...value, description: 'The answer, or null when it cannot be established.' },
			confidence: { type: 'number', minimum: 0, maximum: 1 },
			sources: { type: 'array', items: { type: 'string' }, description: 'URLs that support the answer.' },
		},
		required: ['value', 'confidence', 'sources'],
		additionalProperties: false,
	};
}

/** The system prompt for one column: what shape of answer the cell wants, and the no-invention rule. */
export function systemFor(column) {
	return [
		'You fill one cell of a spreadsheet about a company. You are given the row and, when present, web research.',
		column.type === 'number' ? 'Answer with a single number, no units or formatting.'
			: column.type === 'boolean' ? 'Answer true or false.'
				: column.type === 'list' ? 'Answer with a short list of strings.'
					: 'Answer with a short, specific value: a name, a phrase, or one sentence at most. No preamble.',
		'Return null when the answer cannot be established. Never invent facts.',
	].join('\n');
}
