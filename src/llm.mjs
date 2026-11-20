/** DeepSeek (or any OpenAI-compatible model) over the Cloudflare AI Gateway, with strict JSON schema output. */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Model {
	tokens = 0;
	calls = 0;

	constructor({ apiKey, baseUrl, model, maxTokens = 4096, retries = 3 }) {
		this.apiKey = apiKey;
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.model = model;
		this.maxTokens = maxTokens;
		this.retries = retries;
	}

	/** Returns a parsed object matching `schema`. Throws if the model returns nothing usable. */
	async json({ system, prompt, schema, name = 'result' }) {
		for (let attempt = 0; ; attempt++) {
			this.calls++;
			let response;
			try {
				response = await fetch(`${this.baseUrl}/chat/completions`, {
					method: 'POST',
					headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
					body: JSON.stringify({
						model: this.model,
						messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
						response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
						max_tokens: this.maxTokens,
						temperature: 0.2,
					}),
					signal: AbortSignal.timeout(180_000),
				});
			} catch (error) {
				if (attempt >= this.retries) throw new Error(`model call failed: ${error.message}`);
				await sleep(1500 * 2 ** attempt);
				continue;
			}
			const text = await response.text();
			let data;
			try { data = JSON.parse(text); } catch { data = null; }
			this.tokens += Number(data?.usage?.total_tokens ?? 0);
			if (!response.ok) {
				const retryable = response.status === 429 || response.status >= 500;
				if (!retryable || attempt >= this.retries) {
					throw new Error(`model ${response.status}: ${data?.error?.message ?? data?.message ?? text.slice(0, 200)}`);
				}
				await sleep(1500 * 2 ** attempt);
				continue;
			}
			const content = data?.choices?.[0]?.message?.content;
			if (typeof content !== 'string' || !content.trim()) {
				// Reasoning models occasionally spend the whole budget thinking and emit nothing.
				if (attempt < this.retries) { await sleep(1000); continue; }
				throw new Error('model returned no content');
			}
			try {
				return JSON.parse(content);
			} catch {
				const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
				if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
				if (attempt < this.retries) { await sleep(1000); continue; }
				throw new Error(`model returned invalid JSON: ${content.slice(0, 160)}`);
			}
		}
	}
}
