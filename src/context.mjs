/** Minimal Context.dev client: the three endpoints this pipeline needs, with credit accounting and retries. */

const BASE = 'https://api.context.dev/v1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ContextClient {
	credits = 0;
	calls = 0;

	constructor(apiKey, { timeoutMs = 90_000, retries = 3 } = {}) {
		this.apiKey = apiKey;
		this.timeoutMs = timeoutMs;
		this.retries = retries;
	}

	async #post(path, body, timeoutMs = this.timeoutMs) {
		for (let attempt = 0; ; attempt++) {
			this.calls++;
			let response;
			try {
				response = await fetch(`${BASE}${path}`, {
					method: 'POST',
					headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (error) {
				if (attempt >= this.retries) throw new Error(`${path} failed: ${error.message}`);
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			const text = await response.text();
			let data;
			try { data = JSON.parse(text); } catch { data = null; }
			this.credits += Number(data?.key_metadata?.credits_consumed ?? 0);
			if (response.ok) return data;
			const retryable = response.status === 429 || response.status >= 500;
			if (!retryable || attempt >= this.retries) {
				const message = data?.error?.message ?? data?.message ?? text.slice(0, 200);
				throw new Error(`${path} ${response.status}: ${message}`);
			}
			await sleep(1000 * 2 ** attempt);
		}
	}

	/** One page of company matches. Costs 2 credits. */
	async companySearch({ query, countries, employeesMin, employeesMax, cursor }) {
		const filters = {};
		if (countries?.length) filters.countries = countries;
		if (employeesMin != null) filters.employees_min = employeesMin;
		if (employeesMax != null) filters.employees_max = employeesMax;
		const data = await this.#post('/company/search', { query: query.slice(0, 500), filters: Object.keys(filters).length ? filters : undefined, cursor }, 60_000);
		return { results: data?.results ?? [], next: data?.next_cursor ?? null };
	}

	/** Web search with optional focused passages. Costs 1 credit. */
	async webSearch({ query, numResults = 5, includeDomains, country, freshness, highlights = true }) {
		const data = await this.#post('/web/search', {
			query: query.slice(0, 500),
			numResults,
			includeDomains,
			country,
			freshness,
			highlightsOptions: highlights ? { enabled: true, maxCharacters: 1500 } : undefined,
			timeoutOpts: { milliseconds: 45_000, behavior: 'return-partial' },
		}, 60_000);
		return (data?.results ?? []).map((result) => ({
			url: result.url,
			title: result.title,
			description: result.description,
			highlights: result.highlights?.highlights ?? [],
		}));
	}

	/** Page text as markdown, or only the passages relevant to `query`. Costs 1 credit. */
	async scrape(url, { query, maxChars = 6000, maxAgeMs = 3 * 24 * 60 * 60 * 1000 } = {}) {
		const focused = Boolean(query);
		const data = await this.#post('/web/scrape', {
			url,
			formats: { markdown: true, highlights: focused },
			...(focused ? { highlightsParams: { query: query.slice(0, 2000), maxCharacters: Math.min(maxChars, 20_000) } } : {}),
			sharedParams: { mainContentOnly: true, dismissCookies: true },
			maxAgeMs,
			timeoutOpts: { milliseconds: 60_000, behavior: 'return-partial' },
		}, 90_000);
		const title = data?.metadata?.title;
		if (focused && data?.highlights?.success && data.highlights.data?.length) {
			return { url, title, text: data.highlights.data.join('\n…\n').slice(0, maxChars) };
		}
		if (data?.markdown?.success && data.markdown.data) {
			return { url, title, text: cleanMarkdown(data.markdown.data).slice(0, maxChars) };
		}
		throw new Error(`could not read ${url}: ${data?.markdown?.message ?? data?.markdown?.error_code ?? 'no content'}`);
	}
}

export function cleanMarkdown(markdown) {
	return markdown
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export async function contextUsage(apiKey) {
	const response = await fetch(`${BASE}/org/usage`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`Context.dev rejected the key (${response.status})`);
	const data = await response.json();
	const credits = data.credits_remaining ?? data.remaining_credits ?? data.credits ?? data.balance;
	const used = data.period?.credits_used;
	return { credits, used };
}
