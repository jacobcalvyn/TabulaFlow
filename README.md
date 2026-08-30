# TabulaFlow

An auditable, local-first data workbench where people and AI agents prepare, transform, and compose structured datasets together.

[Open the live app](https://tabulaflow.jacobcalvyn.chatgpt.site) · [WebMCP architecture](docs/WEBMCP.md) · [Reproducible demo](docs/DEMO.md) · [Hackathon notes](docs/HACKATHON.md)

## Why TabulaFlow

Most data tools force an AI agent to guess through visual controls or ask a user to translate every analytical step into clicks. TabulaFlow exposes its real data workflow as strict WebMCP tools while preserving visible user control.

People can inspect and edit the same Source → Prepare → Compose state that agents use. Agents can profile data, validate changes, maintain recipes, create Compose operations, and export results without bypassing the product's privacy and concurrency boundaries.

## Product workflow

### Source

- Import Excel, CSV, JSON, JSONL, and NDJSON.
- Keep local files on the device unless the user explicitly chooses another import mode.
- Restore permitted browser file handles or request a visible re-link when permission is unavailable.
- Accept an agent-workspace upload only after visible session consent. Uploaded bytes use a short-lived capability, verified size and SHA-256 digest, and temporary object storage that is deleted after import or expiry.
- Offer optional signed-in cloud storage for files the user explicitly uploads.

### Prepare

- Profile empty cells, mixed types, value frequencies, and column semantics.
- Build an ordered, versioned transformation recipe with undo, redo, enable, disable, edit, and reordering.
- Create safe row-level Formula columns through a versioned allowlisted expression language.
- Review qualitative coding suggestions against a human-owned codebook.
- Export the current filtered result to CSV or Excel.

### Compose

- Combine prepared datasets through Append, Join, and Difference.
- Build chainable Aggregate, Filter, Distinct, Pivot, and Unpivot operations.
- Validate candidate operations before committing them.
- Inspect output schema, preview, quality, provenance, and execution state.
- Promote an operation result into an independent prepared dataset.

## WebMCP

TabulaFlow WebMCP contract `3.3.0` registers 17 stable browser tools. Five bounded workspace dispatchers expose 60 action routes with strict, discoverable JSON schemas. The stable surface avoids registration churn while retaining full Source, Prepare, and Compose semantics.

Key guarantees include:

- explicit `preparedId` and `nodeId` targets;
- optimistic concurrency through `workspaceRevision`;
- flow-scoped idempotency through `requestId`;
- dry-run validation before supported mutations;
- asynchronous operation lifecycle and cooperative cancellation;
- protected recipe values and conservative preview redaction;
- visible consent for agent uploads and visible confirmation for destructive actions;
- one privacy-safe activity ledger shared by user and agent changes.

Read [docs/WEBMCP.md](docs/WEBMCP.md) for the architecture, dispatcher map, safeguards, and invocation pattern.

## Quick start

Requirements:

- Node.js 20 or newer
- npm

```bash
git clone https://github.com/jacobcalvyn/TabulaFlow.git
cd TabulaFlow
npm install
npm run dev
```

Open the URL printed by Vite. WebMCP requires ChatGPT's in-app browser or a compatible browser with WebMCP enabled. Unsupported browsers keep the full human-operated application available without agent tools.

## Reproducible demo

The repository includes a synthetic, non-PII shipment fixture at [`examples/webmcp-demo.csv`](examples/webmcp-demo.csv). It is designed for a deterministic Source → Prepare → Compose walkthrough.

Follow [docs/DEMO.md](docs/DEMO.md) to reproduce the judge flow using WebMCP directly.

## Data and privacy model

DuckDB-Wasm runs in a dedicated browser worker. It owns table storage, aggregate queries, filters, recipe execution, quality profiling, previews, and exports.

Local source data remains immutable while a working dataset is rebuilt from its recipe. Local files are not uploaded automatically. Agent-workspace and cloud uploads are explicit alternative import paths with separate consent and lifecycle rules.

Sensitive WebMCP previews are redacted. Sensitive frequency values use opaque references instead of raw values. Destructive requests open visible confirmation and cannot be confirmed by the agent.

## Browser limits

| Resource | Limit |
| --- | ---: |
| Import size | 50 MB per file |
| Rows | 100,000 |
| Stored columns | 1,000 |
| Profiled mini-tables | 200 columns at a time |
| Export rows | 50,000 |
| WebMCP preview | 20 rows × 20 explicit columns |

These limits keep browser memory and agent responses bounded.

## Validation

```bash
npm test
npm run build
npm run test:sites
```

The production build emits the client, Cloudflare-compatible server entrypoint, and Sites hosting metadata.

## Project structure

```text
src/App.jsx                 Application UI and shared workspace state
src/data.worker.js          DuckDB-Wasm analytical worker
src/useWebMcpTools.js       Stable WebMCP tools and action contracts
src/webMcpMutation.js       Revision, idempotency, async, and cancellation lifecycle
src/transformations.js      Deterministic Prepare recipe compiler
src/composeSql.js           Transactional Compose validation and SQL generation
src/recipeStorage.js        IndexedDB flow persistence
worker/index.js             Sites worker, cloud files, and temporary agent uploads
examples/                   Synthetic judging fixture
docs/                       Architecture, demo, and hackathon evidence
tests/                      Product, worker, hosting, and WebMCP contract tests
```

## Hackathon development

TabulaFlow was created during the OpenAI WebMCP Challenge submission period. The dated development evidence and judging-criteria mapping are documented in [docs/HACKATHON.md](docs/HACKATHON.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
