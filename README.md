# TabulaFlow

TabulaFlow is a local-first browser application for profiling, cleaning, and preparing structured data. Files are processed in the browser with DuckDB-Wasm and are not uploaded to a server.

## Features

- Import Excel, CSV, JSON, JSONL, and NDJSON files.
- Inspect value frequencies for each column with faceted cross-filtering.
- Preview the first 100 matching rows with row virtualization.
- Search, filter, rename, type-cast, and transform columns.
- Track ordered Clean/Build recipes with undo, redo, reordering, and saved-recipe recovery.
- Review empty-cell and mixed-type quality summaries.
- Export the current filtered result to CSV or Excel.
- Switch between English and Indonesian.

## Data engine

DuckDB-Wasm runs in a dedicated browser worker and owns table storage, aggregate queries, filters, recipe execution, quality profiling, previews, and exports. Source data remains immutable while the working dataset is rebuilt from the active recipe.

Worker operations are transactional. React history and persisted recipe state are committed only after DuckDB accepts a change. A timed-out or crashed worker is recreated and rehydrated from the last known-good source, recipe, and filter state.

## Browser limits

| Resource | Limit |
| --- | ---: |
| Import size | 50 MB per file |
| Rows | 100,000 |
| Stored columns | 1,000 |
| Profiled mini-tables | 200 columns at a time |
| Export rows | 50,000 |

These limits keep memory usage bounded in a browser environment. Empty and whitespace-only strings are normalized to `NULL` during ingestion.

## Development

Requirements:

- Node.js 20 or newer
- npm

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Run the validation suite:

```bash
npm test
npm run build
npm run test:sites
```

The production build is written to `dist/client`. The build script also prepares the files required by the included Sites worker adapter.

## Project structure

```text
src/App.jsx                 React application and workspace state
src/data.worker.js         DuckDB-Wasm analytical worker
src/transformations.js     Deterministic recipe compiler
src/recipeStorage.js       IndexedDB recipe persistence
src/useDataWorker.js       Worker lifecycle and recovery supervisor
worker/index.js            Static hosting worker adapter
tests/                     Unit and hosting contract tests
```

## Roadmap

The next architectural milestone is Compose: a multi-source flow workspace inspired by Tableau Prep. Each source keeps an independent Prepare recipe, while Compose will add explicit Append and Join nodes without silently coercing schemas or duplicating source bytes.
