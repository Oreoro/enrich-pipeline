import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, requireEnv } from './env.mjs';
import { ContextClient, contextUsage } from './context.mjs';
import { Model } from './llm.mjs';
import { toCsv, fromCsv } from './csv.mjs';
import { schemaFor, systemFor } from './schema.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const HELP = `
enrich-pipeline — find companies, research them, write a CSV

Usage
  enrich-pipeline <config.json>            run a config
  enrich-pipeline <config.json> --limit 5  cap the number of rows
  enrich-pipeline <config.json> --dry-run  find rows and report cost, enrich nothing
  enrich-pipeline --usage                  show remaining Context.dev credits
  enrich-pipeline --help

Keys live in .env next to this package (see .env.example).
Docs: README.md
`.trim();

const log = (...parts) => console.log(...parts);

export async function mapPool(items, size, worker) {
	const queue = [...items.entries()];
	const results = [];
	await Promise.all(Array.from({ length: Math.min(Math.max(size, 1), queue.length) }, async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const [index, item] = next;
			results[index] = await worker(item, index);
		}
	}));
	return results;
}

const normaliseDomain = (value) => String(value ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

const describeRow = (row) => [
	`Company: ${row.name}`,
	`Website: ${row.domain}`,
	row.description ? `Description: ${row.description}` : null,
	row.industries?.length ? `Industries: ${row.industries.slice(0, 4).join(', ')}` : null,
	row.headquarters ? `Headquarters: ${[row.headquarters.city, row.headquarters.region, row.headquarters.country_code].filter(Boolean).join(', ')}` : null,
	row.employees?.count ? `Employees: ${row.employees.count}` : null,
	row.founded_year ? `Founded: ${row.founded_year}` : null,
].filter(Boolean).join('\n');

const hq = (row) => [row.headquarters?.city, row.headquarters?.region, row.headquarters?.country_code].filter(Boolean).join(', ');

export async function main(argv = process.argv.slice(2)) {
	loadEnv();

	const flag = (name) => {
		const index = argv.indexOf(`--${name}`);
		if (index === -1) return undefined;
		const value = argv[index + 1];
		return value && !value.startsWith('--') ? value : true;
	};

	if (argv.includes('--help') || argv.includes('-h') || (!argv.length && !process.stdin.isTTY)) {
		console.log(HELP);
		return;
	}

	const context = new ContextClient(requireEnv('CONTEXT_DEV_API_KEY'));

	if (argv.includes('--usage')) {
		const usage = await contextUsage(process.env.CONTEXT_DEV_API_KEY);
		log(`Context.dev credits: ${usage.credits ?? 'unknown'}${usage.used != null ? ` (used ${usage.used} this period)` : ''}`);
		return;
	}

	const configPath = flag('config') ?? argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.json'));
	if (!configPath) {
		console.log(HELP);
		throw new Error('No config file given.');
	}

	const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
	const limit = flag('limit') ? Number(flag('limit')) : undefined;
	const target = Math.max(1, Math.min(limit ?? config.target ?? 10, config.target ?? limit ?? 10));
	const concurrency = Number(flag('concurrency') ?? config.concurrency ?? 4);
	const columns = config.columns ?? [];
	const dryRun = argv.includes('--dry-run');
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const outDir = resolve(flag('out') ?? join(root, 'out', `${(config.name ?? 'run').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-${stamp}`));

	log(`\n▶ ${config.name ?? 'run'} — ${target} rows`);

	const found = [];
	const seenDomains = new Set();

	if (config.inputCsv) {
		const records = fromCsv(readFileSync(resolve(config.inputCsv), 'utf8'));
		const domainKey = config.domainColumn ?? 'Domain';
		const nameKey = config.nameColumn ?? 'Company';
		for (const record of records) {
			const domain = normaliseDomain(record[domainKey] ?? record.domain ?? record.website);
			if (!domain || seenDomains.has(domain)) continue;
			seenDomains.add(domain);
			found.push({ name: String(record[nameKey] ?? record.name ?? domain).trim(), domain, ...record });
			if (found.length >= target) break;
		}
		log(`  ${config.inputCsv}: ${found.length}/${target} rows`);
		if (config.lookupCompany !== false) {
			await mapPool(found, Math.min(concurrency, found.length), async (row) => {
				const match = await context.companySearch({ query: row.domain })
					.then((page) => page.results.find((hit) => normaliseDomain(hit.domain) === row.domain) ?? page.results[0] ?? null)
					.catch(() => null);
				if (match) Object.assign(row, { ...match, name: row.name, domain: row.domain });
			});
			log(`  company records: ${found.filter((row) => row.description).length}/${found.length} (${context.credits} credits)`);
		}
	} else {
		if (!config.query) throw new Error('Config needs either "query" (discover rows) or "inputCsv" (enrich a list).');
		let cursor;
		let pages = 0;
		while (found.length < target && pages < (config.maxPages ?? 10)) {
			pages++;
			const page = await context.companySearch({ query: config.query, countries: config.countries, employeesMin: config.employeesMin, employeesMax: config.employeesMax, cursor });
			for (const hit of page.results) {
				const domain = normaliseDomain(hit.domain);
				if (!domain || seenDomains.has(domain)) continue;
				seenDomains.add(domain);
				found.push({ ...hit, domain });
				if (found.length >= target) break;
			}
			log(`  page ${pages}: ${page.results.length} results → ${found.length}/${target} rows (${context.credits} credits)`);
			cursor = page.next;
			if (!cursor) break;
		}
	}

	const rows = found.slice(0, target);
	if (!rows.length) throw new Error('No rows found for that query.');

	if (dryRun) {
		for (const row of rows) log(`  · ${row.name} (${row.domain})`);
		log(`\nDry run: ${rows.length} rows × ${columns.length} columns · ${context.credits} credits spent finding them.`);
		return;
	}

	if (!columns.length) throw new Error('Config has no "columns" to fill.');

	mkdirSync(outDir, { recursive: true });
	const jsonlPath = join(outDir, 'rows.jsonl');
	writeFileSync(jsonlPath, '');

	const model = new Model({
		apiKey: requireEnv('OPENAI_API_KEY'),
		baseUrl: requireEnv('OPENAI_BASE_URL'),
		model: config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
		maxTokens: config.maxTokens ?? 4096,
	});

	const pageCache = new Map();
	function page(url, maxChars) {
		const key = `${url}|${maxChars}`;
		if (!pageCache.has(key)) pageCache.set(key, context.scrape(url, { maxChars }));
		return pageCache.get(key);
	}

	async function research(row, column) {
		const mode = column.research ?? 'none';
		const question = column.question;
		if (mode === 'none') return { context: '', sources: [] };
		if (mode === 'page') {
			const url = column.pageUrl ?? `https://${row.domain}`;
			try {
				const read = await page(url, column.maxChars ?? 12_000);
				return { context: `PAGE (${read.url})${read.title ? ` — ${read.title}` : ''}:\n${read.text}`, sources: [read.url] };
			} catch (error) {
				if (column.fallback === false) throw error;
				return research(row, { ...column, research: 'web' });
			}
		}
		const hits = await context.webSearch({ query: `${row.name} ${question}`.slice(0, 300), numResults: column.numResults ?? 5, highlights: true });
		const sources = hits.map((hit) => hit.url);
		const blocks = hits.slice(0, 4).map((hit, index) => {
			const passages = hit.highlights?.length ? hit.highlights.join('\n') : hit.description ?? '';
			return `[${index + 1}] ${hit.title ?? ''} (${hit.url})\n${passages}`.trim();
		});
		let text = blocks.join('\n\n');
		if (column.readTop !== false && hits[0] && !hits[0].highlights?.length) {
			const read = await context.scrape(hits[0].url, { query: question, maxChars: column.maxChars ?? 6000 }).catch(() => null);
			if (read) text += `\n\nPAGE (${read.url}):\n${read.text}`;
		}
		return { context: `WEB RESULTS:\n${text}`, sources };
	}

	async function runColumn(row, column) {
		const started = Date.now();
		try {
			const { context: contextText, sources } = await research(row, column);
			const result = await model.json({
				name: 'cell',
				schema: schemaFor(column.type),
				system: systemFor(column),
				prompt: [`ROW:\n${describeRow(row)}`, contextText || null, `QUESTION: ${column.question}`].filter(Boolean).join('\n\n'),
			});
			return {
				value: result.value ?? null,
				confidence: result.confidence,
				sources: [...new Set([...(result.sources ?? []), ...sources])].slice(0, 8),
				ms: Date.now() - started,
			};
		} catch (error) {
			return { value: null, confidence: null, sources: [], error: error.message, ms: Date.now() - started };
		}
	}

	const started = Date.now();
	let doneCells = 0;
	let doneRows = 0;

	const cells = rows.map(() => ({}));
	const tasks = rows.flatMap((row, rowIndex) => columns.map((column) => ({ row, rowIndex, column })));
	const perRowRemaining = rows.map(() => columns.length);
	const totalCells = tasks.length;

	await mapPool(tasks, concurrency, async ({ row, rowIndex, column }) => {
		cells[rowIndex][column.header] = await runColumn(row, column);
		doneCells++;
		perRowRemaining[rowIndex]--;
		if (perRowRemaining[rowIndex] === 0) {
			doneRows++;
			const summary = columns.map((entry) => `${entry.header}=${JSON.stringify(cells[rowIndex][entry.header]?.value)?.slice(0, 40)}`).join('  ');
			log(`  [${String(doneRows).padStart(String(rows.length).length)}/${rows.length}] ${row.name.slice(0, 28).padEnd(28)} ${summary}`);
			appendFileSync(jsonlPath, `${JSON.stringify({ row: rowIndex, company: row, cells: cells[rowIndex] })}\n`);
		} else {
			log(`      ${String(doneCells).padStart(String(totalCells).length)}/${totalCells} cells · ${row.name.slice(0, 20)} · ${column.header}`);
		}
	});

	const enriched = rows.map((row, index) => ({ row: index, company: row, cells: cells[index] }));

	const aiHeaders = new Set(columns.map((column) => column.header));
	const base = (header) => (aiHeaders.has(header) ? `${header} (context.dev)` : header);
	const csvColumns = [
		{ header: base('Company'), value: (record) => record.company.name },
		{ header: base('Domain'), value: (record) => record.company.domain },
		{ header: base('Description'), value: (record) => record.company.description },
		{ header: base('Industry'), value: (record) => record.company.industries?.slice(0, 3) },
		{ header: base('Headquarters'), value: (record) => hq(record.company) },
		{ header: base('Employees'), value: (record) => record.company.employees?.count ?? record.company.employees?.max },
		{ header: base('Founded'), value: (record) => record.company.founded_year },
		{ header: base('Funding USD'), value: (record) => record.company.funding?.total_usd },
		...columns.map((column) => ({ header: column.header, value: (record) => record.cells[column.header]?.value })),
	];

	writeFileSync(join(outDir, 'rows.csv'), toCsv(enriched, csvColumns));
	writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({
		config,
		rows: enriched.length,
		columns: columns.length,
		model: model.model,
		contextCredits: context.credits,
		modelCalls: model.calls,
		modelTokens: model.tokens,
		wallMs: Date.now() - started,
		failures: enriched.flatMap((record) => Object.entries(record.cells).filter(([, cell]) => cell.error).map(([header, cell]) => ({ company: record.company.name, column: header, error: cell.error }))),
		startedAt: stamp,
	}, null, 2)}\n`);

	const failures = enriched.flatMap((record) => Object.values(record.cells).filter((cell) => cell.error)).length;
	const blanks = enriched.flatMap((record) => Object.values(record.cells).filter((cell) => !cell.error && cell.value === null)).length;

	log(`\n✔ ${enriched.length} rows × ${columns.length} columns in ${((Date.now() - started) / 1000).toFixed(1)}s`);
	log(`  context.dev: ${context.credits} credits · model: ${model.calls} calls, ${model.tokens} tokens`);
	log(`  null answers: ${blanks} · failures: ${failures}`);
	log(`  → ${join(outDir, 'rows.csv')}`);
	log(`  → ${join(outDir, 'rows.jsonl')} (confidence + sources)`);
	log(`  → ${join(outDir, 'manifest.json')}`);
	if (!existsSync(join(outDir, 'rows.csv'))) throw new Error('output missing');
}
