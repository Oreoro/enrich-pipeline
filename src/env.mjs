import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv(file = join(here, '..', '.env')) {
	const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
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
	if (!value) throw new Error(`Set ${name} in .env (see .env.example)`);
	return value;
}
