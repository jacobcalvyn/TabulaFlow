# Reproducible WebMCP demo

This walkthrough demonstrates TabulaFlow through WebMCP directly. It does not use DOM selectors or simulated clicks for data operations.

## Goal

Import a synthetic shipment dataset, profile it, create a Formula column, and aggregate shipment weight by service.

Expected final result:

| service | shipment_count | average_actual_weight_kg |
| --- | ---: | ---: |
| ECONOMY | 8 | 0.4875 |
| EXPRESS | 8 | 1.3125 |
| REGULAR | 8 | 0.8750 |

## Prerequisites

- Open [the public TabulaFlow app](https://tabulaflow.jacobcalvyn.chatgpt.site) in ChatGPT's in-app browser.
- Give the agent access to [`examples/webmcp-demo.csv`](../examples/webmcp-demo.csv) in its workspace.
- Do not use a production or personal dataset for this demonstration.

## 1. Discover the runtime

Call:

1. `tabulaflow_get_capabilities`
2. `tabulaflow_get_workspace_state`
3. `tabulaflow_get_workflow_guide`

Verify contract `3.3.0`, runtime health `available`, and 17 registered/callable tools.

## 2. Import the fixture from the agent workspace

1. Calculate the exact file size and lowercase SHA-256 digest.
2. Call `tabulaflow_source` with `action: get_action_contract` for `begin_agent_upload`.
3. Call `begin_agent_upload` with the fixture metadata and a unique request ID.
4. Approve **Allow AI uploads** in the visible Source prompt.
5. Retry `begin_agent_upload` with a new request ID.
6. Upload the exact bytes to the returned URL with HTTP `PUT`.
7. Call `get_agent_upload_status` and verify `status: uploaded`.
8. Read the latest workspace revision.
9. Call `commit_agent_upload` with `executionMode: wait`.

Expected result: a linked `webmcp-demo` prepared dataset with 24 rows and 8 columns.

The visible consent is part of the demo. It proves that WebMCP can coordinate a cloud agent file without silently bypassing user authority.

## 3. Profile the dataset

Use `tabulaflow_prepare_read` to discover and call:

- `get_prepare_dataset`
- `get_data_profile`
- `get_prepare_preview`

Select only explicit non-sensitive columns for previews. Confirm that `shipment_id` is unique and each service contains eight rows.

## 4. Create a Formula column

Discover the `add_recipe_step` contract through `tabulaflow_prepare_mutate`.

Add a Formula column named `weight_gap_kg` with this expression:

```text
[chargeable_weight_kg] - [actual_weight_kg]
```

Use the latest workspace revision, a unique request ID, and `executionMode: wait`. Read the recipe and preview the new column after the operation succeeds.

Expected result: 24 rows and 9 columns. The original source remains immutable.

## 5. Create a Compose Aggregate

1. Open Compose with `tabulaflow_open_workspace`.
2. Read the graph and active prepared ID.
3. Discover `validate_compose_operation` and `create_compose_operation` contracts.
4. Validate an Aggregate grouped by `service` with:
   - `count` as `shipment_count`;
   - `average` of `actual_weight_kg` as `average_actual_weight_kg`.
5. Create the validated operation with the latest revision and a unique request ID.
6. Read its schema, preview, and quality.

Expected result: 3 rows and 3 columns with the values shown above.

## 6. Show collaboration safeguards

Demonstrate one non-destructive guard:

- replay the same create request ID and verify that no second node appears; or
- send a stale revision and verify structured `STALE_STATE`; or
- inspect the shared activity ledger and show user/agent attribution.

Do not confirm reset or deletion during the judging demo.

## 7. Optional export

Read the latest revision and export the Aggregate to CSV through `tabulaflow_compose_mutate`. Export is a revisioned, idempotent side effect.

## Demo recording outline

Keep the public video below three minutes:

1. **0:00–0:20** — problem and Source → Prepare → Compose model;
2. **0:20–0:55** — capabilities, upload request, and visible consent;
3. **0:55–1:35** — profile and Formula column;
4. **1:35–2:15** — validated Aggregate and preview;
5. **2:15–2:40** — idempotency or stale-revision safeguard;
6. **2:40–2:55** — impact and closing statement.

Use audio and show actual WebMCP calls or their structured results. Do not substitute a manifest-only inspection for a working data-path demo.
