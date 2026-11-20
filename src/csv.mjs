/** CSV writing that survives quotes, commas and newlines in values. */

const cell = (value) => {
	if (value === null || value === undefined) return '';
	const text = Array.isArray(value) ? value.join('; ') : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows, columns) {
	const lines = [columns.map((column) => cell(column.header)).join(',')];
	for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(','));
	return `${lines.join('\n')}\n`;
}

/** Parses RFC 4180 CSV (quoted fields, embedded commas/newlines, doubled quotes) into objects keyed by header. */
export function fromCsv(text) {
	const records = [];
	let field = '';
	let record = [];
	let quoted = false;
	const pushField = () => { record.push(field); field = ''; };
	const pushRecord = () => { pushField(); if (record.some((value) => value !== '')) records.push(record); record = []; };
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (char === '"') {
				if (text[index + 1] === '"') { field += '"'; index++; } else quoted = false;
			} else field += char;
			continue;
		}
		if (char === '"') { quoted = true; continue; }
		if (char === ',') { pushField(); continue; }
		if (char === '\r') continue;
		if (char === '\n') { pushRecord(); continue; }
		field += char;
	}
	if (field !== '' || record.length) pushRecord();
	const [header, ...body] = records;
	if (!header) return [];
	return body.map((values) => Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ''])));
}
