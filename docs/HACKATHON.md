# OpenAI WebMCP Challenge notes

TabulaFlow was created during the OpenAI WebMCP Challenge submission period. This document distinguishes dated implementation evidence from submission claims.

## Entry summary

- **Project:** TabulaFlow
- **Live app:** https://tabulaflow.jacobcalvyn.chatgpt.site
- **Repository:** https://github.com/jacobcalvyn/TabulaFlow
- **License:** Apache-2.0
- **WebMCP contract:** `3.3.0`

## Problem

Data preparation tools are visually dense, stateful, and difficult for an agent to operate reliably through generic browser interaction. A small mistake can transform the wrong dataset, expose sensitive values, duplicate a long-running mutation, or erase user work.

TabulaFlow gives people and agents one auditable data workflow. Agents receive typed semantic actions instead of UI coordinates. People retain authority over file access, destructive confirmation, semantic declassification, and qualitative interpretation.

## Development evidence

The repository history begins after the challenge submission period opened.

| Date | Commit | Evidence |
| --- | --- | --- |
| 2026-08-26 | `c4f085b` | Initialized the TabulaFlow data-preparation application |
| 2026-08-28 | `ac5f1f4` | Added persistent Prepare and Compose workflows |
| 2026-08-28 | `b93df26` | Added WebMCP automation and visible AI access |
| 2026-08-28 | `83a738f` | Added the shared user/agent activity ledger |
| 2026-08-29 | `f42277d` | Added safe Formula columns |
| 2026-08-30 | `10bce04` | Added registration, privacy, and control-plane hardening |
| 2026-08-30 | `9ee3f3d` | Made mutation cancellation explicit and testable |
| 2026-08-30 | `889f26c` | Expanded the bounded Formula language and WebMCP coverage |
| 2026-08-30 | `f40da14` | Added consent-gated agent-workspace uploads |

The commit history remains the source of truth for exact timestamps and changes.

## Why WebMCP is essential

Without WebMCP, an agent must infer application state from a large virtualized table, popovers, graph coordinates, and transient UI. It cannot safely prove which dataset revision it changed.

With WebMCP, the agent can:

- inspect the current flow, schema, quality, preview, recipe, and graph;
- discover strict action-specific contracts;
- validate recipe and Compose changes before committing them;
- target stable datasets and nodes;
- retry safely through idempotency;
- observe terminal asynchronous outcomes;
- preserve protected values without reading them;
- share one visible history with the user.

The user can see and continue every committed change in the normal interface.

## Judging criteria mapping

### WebMCP Leverage

- 17 stable tools and 60 Source/Prepare/Compose action routes.
- Strict schemas with action-level discovery.
- Full observation, validation, mutation, operation-status, cancellation, and activity paths.
- WebMCP routes to the same application handlers as the UI.

### Execution

- Public, no-login Source → Prepare → Compose product.
- DuckDB-Wasm analytical worker with transactional recipes and operations.
- IndexedDB flow persistence and Cloudflare-compatible Sites deployment.
- Automated product, privacy, worker, WebMCP, and hosting tests.

### Potential Impact

- Makes advanced data preparation accessible without requiring SQL.
- Reduces agent errors caused by UI guessing and stale state.
- Keeps sensitive data and irreversible decisions under explicit controls.
- Supports local files and files already available in a cloud agent workspace.

### Creativity and Ambition

- Treats WebMCP as a collaborative data control plane instead of click automation.
- Combines protected values, revision causality, idempotency, cancellation, and human confirmation.
- Enables evidence-backed qualitative coding while keeping codebooks and acceptance human-owned.

## Safety boundaries demonstrated

- Local device selection and re-link require a visible user gesture.
- Agent-workspace upload requires visible session consent and a short-lived capability.
- Destructive requests create pending confirmation but cannot be confirmed by an agent.
- Sensitive previews are redacted and sensitive frequency groups use opaque references.
- Semantic declassification requires visible user action.
- Cancelled pre-commit operations do not advance workspace revision.

## Known limitations

- Local browser file handles may require re-link after permission loss or browser reload.
- Browser resource limits cap imports at 50 MB, 100,000 rows, and 1,000 stored columns.
- Formula columns are deterministic and row-level; window, rank, LOD, regex, and nondeterministic time functions are intentionally excluded.
- Local file and operating-system permission dialogs remain human interactions.
- WebMCP requires ChatGPT's in-app browser or another compatible browser implementation.

## Submission checklist

- [x] Public live URL
- [x] Public source repository
- [x] Open-source license
- [x] Reproducible non-PII demo fixture
- [x] WebMCP architecture documentation
- [x] Dated development evidence
- [ ] Public YouTube demo with audio, under three minutes
- [ ] Final English Devpost description
- [ ] GitHub About description, live website, and topics
- [ ] Final judge run from a fresh browser session

## Suggested submission statement

> TabulaFlow is an auditable data workbench where people stay in control while AI agents inspect, transform, compose, and validate real datasets through structured WebMCP tools. Agents get semantic operations, not coordinates; people retain authority over file access, deletion, declassification, and interpretation.
