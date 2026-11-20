# enrich-pipeline

Turns a prompt or a CSV into an enriched CSV. Context.dev provides web search, scraping and company data; an
OpenAI-compatible chat model answers one question per cell. Node 20+, no dependencies, no database.

```bash
node bin/enrich-pipeline.mjs examples/solar-us.json
```

```
▶ solar-us — 10 rows
  page 1: 10 results → 10/10 rows (2 credits)
  [1/10] Universal Solar Products Inc  What they do="It manufactures solar water heaters…"  CEO="Osvaldo Rios"  Employees=68
  [2/10] Akash Corporation             What they do="Akash Corporation provides solar…"     CEO=null            Employees=52
✔ 10 rows × 4 columns in 96.4s
  context.dev: 61 credits · model: 40 calls, 53k tokens
  null answers: 4 · failures: 0
```

## Install

```bash
git clone https://github.com/Oreoro/enrich-pipeline
cd enrich-pipeline
cp .env.example .env
node bin/enrich-pipeline.mjs --usage
```

Global CLI: `npm i -g .` then `enrich-pipeline --help`.

## Keys

| Variable | Description |
| --- | --- |
| `CONTEXT_DEV_API_KEY` | Context.dev key ([context.dev](https://context.dev)) |
| `OPENAI_API_KEY` | Key for the chat endpoint (OpenAI key or Cloudflare API token) |
| `OPENAI_BASE_URL` | Chat endpoint, e.g. `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model id, e.g. `gpt-4.1-mini` or `@cf/deepseek-ai/deepseek-v4.1-flash-1017` |

Workers AI through an AI Gateway works with `OPENAI_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/compat`.
The model must support strict JSON schema output (`response_format: json_schema`).

## Commands

```bash
enrich-pipeline examples/solar-us.json              # discover rows from a query, then enrich
enrich-pipeline examples/my-list.json               # enrich an existing CSV
enrich-pipeline examples/solar-us.json --limit 3    # cap rows
enrich-pipeline examples/solar-us.json --dry-run    # find rows, report cost, enrich nothing
enrich-pipeline examples/solar-us.json --out dir/   # output directory
enrich-pipeline --usage                             # Context.dev credits remaining
enrich-pipeline --help
```

## Config

```json
{
  "name": "solar-us",
  "query": "Solar companies in the United States with 50 or more employees",
  "target": 10,
  "countries": ["US"],
  "employeesMin": 50,
  "concurrency": 8,
  "columns": [
    { "header": "What they do", "question": "In one sentence, what does this company do?", "research": "page" },
    { "header": "CEO", "question": "Who is the CEO? Answer with just the name.", "research": "web" },
    { "header": "Free tier", "question": "Does their pricing page mention a free tier?", "type": "boolean", "research": "web" },
    { "header": "Employees", "question": "How many employees do they have?", "type": "number", "research": "web" }
  ]
}
```

### Row discovery

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | string | — | Plain-language company description |
| `target` | number | 10 | Rows to collect |
| `countries` | string[] | — | Country codes, e.g. `["US", "GB"]` |
| `employeesMin` / `employeesMax` | number | — | Headcount filter |
| `maxPages` | number | 10 | Search pages to walk |

### CSV input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `inputCsv` | string | — | CSV to enrich instead of discovering rows |
| `domainColumn` / `nameColumn` | string | `Domain` / `Company` | Header names to read |
| `lookupCompany` | boolean | `true` | Resolve each domain to a company record (2 credits/row) |

### Columns

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `header` | string | — | CSV column name |
| `question` | string | — | Question answered for each row |
| `type` | string | `string` | `string`, `number`, `boolean`, `list` |
| `research` | string | `none` | `none`, `page` (homepage), `web` (search + top hit) |
| `fallback` | boolean | `true` | In `page` mode, use `web` when the site cannot be read |
| `pageUrl` | string | — | Override the page read in `page` mode |
| `maxChars` | number | 12000 / 6000 | Characters kept from a page |
| `numResults` | number | 5 | Search results per question |
| `readTop` | boolean | `true` | In `web` mode, scrape the top hit when it has no passages |

`concurrency` (default 4) caps in-flight cells across rows and columns.

## Output

```
out/<name>-<timestamp>/
  rows.csv
  rows.jsonl
  manifest.json
```

`rows.csv` — one row per company, one column per question:

```csv
Company,Domain,Description,Industry,Headquarters,Employees,Founded,Funding USD,What they do,CEO,Free tier,Employees (context.dev)
Stripe,stripe.com,"Stripe provides financial infrastructure…",Financial Services,"San Francisco, CA, US",8000,2010,,…,Patrick Collison,false,
```

A Context.dev field that shares a name with an AI column is suffixed `(context.dev)`.

`rows.jsonl` — per cell: `value`, `confidence`, `sources`, `ms`, and `error` when the cell failed:

```json
{"row":0,"company":{"name":"Stripe","domain":"stripe.com"},"cells":{"CEO":{"value":"Patrick Collison","confidence":1,"sources":["https://stripe.com/about"],"ms":6008}}}
```

`manifest.json` — `contextCredits`, `modelCalls`, `modelTokens`, `wallMs`, and every failed cell.

## Cost and speed

Measured with DeepSeek V4.1 Flash on Workers AI, concurrency 6–8:

| Run | Wall time | Credits | Tokens |
| --- | --- | --- | --- |
| 3 rows × 4 columns (CSV input) | 16s | 27 | 18k |
| 6 rows × 4 columns (discovery) | 61s | 45 | 32k |

Context.dev charges 2 credits per company-search page, 1 per web search, 1 per page scrape. Pages are cached per URL per
run, so several columns on one row cost one scrape.

## Models

| Model | Notes |
| --- | --- |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Best quality/speed on Workers AI: ~4s per cell |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Fastest (~2s); more `null` answers on open-ended questions |
| `@cf/openai/gpt-oss-120b` | Strongest reasoning, 15–80s per cell; needs a high `maxTokens` |
| `gpt-4.1-mini`, `gpt-5.4-mini` | OpenAI defaults |

Not recommended on the Workers AI gateway: `@cf/qwen/*`, `@cf/meta/llama-4-scout-*`, `@cf/mistralai/*` — wrong answers
or JSON corrupted at escaped quotes in testing.

## Behaviour

- `null` means the answer could not be established; the model is instructed not to invent facts.
- A failed cell is recorded in `manifest.json` and `rows.jsonl`; the run continues.
- Research is fixed per column (`page` or `web`), not chosen by the model, so cost and latency are predictable.

## Tests

```bash
npm test
```

## License

MIT © 2026 Bilal Arshad
