# enrich-pipeline

Turn a prompt — or a CSV you already have — into an enriched CSV. **Context.dev** does the web (search, scraping,
company data), **any OpenAI-compatible model** does the reasoning. No database, no browser, no UI: one Node process,
zero dependencies.

```bash
node bin/enrich-pipeline.mjs examples/solar-us.json
```

```
▶ solar-us — 10 rows
  page 1: 10 results → 10/10 rows (2 credits)
  [1/10] Universal Solar Products Inc  What they do="It manufactures solar water heaters…"  CEO="Osvaldo Rios"  Employees=68
  [2/10] Akash Corporation             What they do="Akash Corporation provides solar…"     CEO=null            Employees=52
  …
✔ 10 rows × 4 columns in 96.4s
  context.dev: 61 credits · model: 40 calls, 53k tokens
  null answers: 4 · failures: 0
```

## Why

The usual stack for this is a spreadsheet app plus a queue plus a database. If all you want is *rows with answers and
sources*, that is a lot of moving parts. This is the same job as a script: read config → find rows → research each cell
→ write CSV + JSONL.

Two design choices keep it cheap and predictable:

- **Deterministic research.** The pipeline decides what to read (`page` or `web`), instead of letting the model drive a
  tool loop. No dependency on tool-call support, no runaway loops, one or two Context.dev credits per cell.
- **One question, one call.** Each cell is a single strict JSON-schema call that returns `value`, `confidence` and
  `sources`. Failures are recorded per cell and never abort the run.

## Install

Requires Node 20+. There is nothing to install — no dependencies.

```bash
git clone https://github.com/Oreoro/enrich-pipeline
cd enrich-pipeline
cp .env.example .env      # add your keys
node bin/enrich-pipeline.mjs --usage
```

Or install the CLI globally: `npm i -g .` then `enrich-pipeline --help`.

## Keys

| Variable | What it is |
| --- | --- |
| `CONTEXT_DEV_API_KEY` | Context.dev key — search, scraping, company data ([get one](https://context.dev)) |
| `OPENAI_API_KEY` | Key for the chat endpoint (an OpenAI key, or a Cloudflare API token) |
| `OPENAI_BASE_URL` | Chat endpoint, e.g. `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model id, e.g. `gpt-4.1-mini` or `@cf/deepseek-ai/deepseek-v4.1-flash-1017` |

No OpenAI account? Point `OPENAI_BASE_URL` at a Cloudflare AI Gateway `/compat` endpoint and use a Workers AI model id.
The model must support **strict JSON schema** output (`response_format: json_schema`).

## Run

```bash
enrich-pipeline examples/solar-us.json              # discover rows from a prompt, then enrich
enrich-pipeline examples/my-list.json               # enrich an existing CSV
enrich-pipeline examples/solar-us.json --limit 3    # cap rows
enrich-pipeline examples/solar-us.json --dry-run    # find rows, report cost, enrich nothing
enrich-pipeline --usage                             # Context.dev credits left
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

| Field | Meaning |
| --- | --- |
| `query` | Plain-language description of the companies to find |
| `target` | How many rows to collect (default 10) |
| `countries` | Country codes to filter on, e.g. `["US", "GB"]` |
| `employeesMin` / `employeesMax` | Headcount filter |
| `maxPages` | Stop after this many search pages (default 10) |

### Or bring your own list

| Field | Meaning |
| --- | --- |
| `inputCsv` | CSV to enrich instead of discovering rows |
| `domainColumn` / `nameColumn` | Header names to read (default `Domain` / `Company`) |
| `lookupCompany` | Look each domain up to fill description, employees, HQ (default `true`, 2 credits/row) |

### Columns

| Field | Meaning |
| --- | --- |
| `header` | CSV column name |
| `question` | Plain-English question. Reference nothing — the whole row is supplied as context |
| `type` | `string` (default), `number`, `boolean`, `list` |
| `research` | `none` (row only), `page` (homepage), `web` (search + read the top hit) |
| `fallback` | In `page` mode, fall back to `web` when a site is dead (default `true`) |
| `maxChars`, `numResults`, `readTop`, `pageUrl` | Research tuning |

`concurrency` (default 4) caps in-flight **cells**, across rows and columns.

## Output

```
out/<name>-<timestamp>/
  rows.csv        flat values, ready for Sheets or Excel
  rows.jsonl      every cell with confidence + sources, plus the full company record
  manifest.json   credits, tokens, wall time, per-cell failures
```

`rows.csv`:

```csv
Company,Domain,Description,Industry,Headquarters,Employees,Founded,Funding USD,What they do,CEO,Free tier,Employees (context.dev)
Stripe,stripe.com,"Stripe provides financial infrastructure…",Financial Services,"San Francisco, CA, US",8000,2010,,…,Patrick Collison,false,
```

An AI column that collides with a Context.dev field keeps its name; the Context.dev one is suffixed.

`rows.jsonl`:

```json
{"row":0,"company":{"name":"Stripe","domain":"stripe.com"},"cells":{"CEO":{"value":"Patrick Collison","confidence":1,"sources":["https://stripe.com/about"],"ms":6008}}}
```

## Cost and speed

Measured with DeepSeek V4.1 Flash on Workers AI, concurrency 6–8:

| Run | Wall time | Context.dev credits | Model tokens |
| --- | --- | --- | --- |
| 3 rows × 4 columns (CSV input) | ~16s | 27 | ~18k |
| 6 rows × 4 columns (discovery) | ~61s | 45 | ~32k |

Context.dev charges 2 credits per company-search page, 1 per web search, 1 per page scrape. Page reads are cached per
URL per run, so several columns on one row cost one scrape.

## Picking a model

| Model | Notes |
| --- | --- |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Best quality/speed on Workers AI: ~4s per cell, 6/6 correct in testing |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Fastest (~2s), but returns `null` more often on open-ended questions |
| `@cf/openai/gpt-oss-120b` | Strongest reasoning, 15–80s per cell; needs a large `maxTokens` or it returns nothing |
| `gpt-4.1-mini` / `gpt-5.4-mini` | Good defaults on OpenAI |

Avoid `@cf/qwen/*`, `@cf/meta/llama-4-scout-*` and `@cf/mistralai/*` on the gateway: they produced wrong answers or
JSON corrupted at escaped quotes in testing.

## Notes

- `null` means the model could not establish the answer. It is told never to invent facts, so specific questions
  ("Who is the CEO?") land far more often than open-ended ones ("What does this company do?").
- Cells are independent: a failed cell is recorded in `manifest.json` and the run continues.
- `--dry-run` costs only the row-discovery credits and prints what would be enriched.

## Tests

```bash
npm test
```

## License

MIT © 2026 Bilal Arshad
