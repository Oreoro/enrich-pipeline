import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Reads pipeline/.env (KEY=value, # comments, optional quotes) without overriding the real environment. */
export function loadEnv(file = join(here, '..', '.env')) {
	let text = '';
	try { text = readFileSync(file, 'utf8'); } catch { /* env only */ }
	for (const line of text.split('\n')) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		const [, key, raw] = match;
		if (process.env[key] !== undefined) continue;
		process.env[key] = raw.trim().replace(/^["']|["']$/g, '');
	}
	return process.env;
}

export function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Set ${name} in pipeline/.env`);
	return value;
}
