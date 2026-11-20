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

const ANSWER_SHAPE = {
	number: 'Answer with a single number, no units or formatting.',
	boolean: 'Answer true or false.',
	list: 'Answer with a short list of strings.',
	string: 'Answer with a short, specific value: a name, a phrase, or one sentence at most. No preamble.',
};

export function systemFor(column) {
	return [
		'You fill one cell of a spreadsheet about a company. You are given the row and, when present, web research.',
		ANSWER_SHAPE[column.type] ?? ANSWER_SHAPE.string,
		'Return null when the answer cannot be established. Never invent facts.',
	].join('\n');
}
