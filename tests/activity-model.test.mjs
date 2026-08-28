import assert from "node:assert/strict";
import test from "node:test";
import { createActivityEvent, findSupersededActivity, pageActivityEvents, sanitizeActivitySummary } from "../src/activityModel.js";

test("activity summaries retain operational metadata without raw data values", () => {
  assert.deepEqual(sanitizeActivitySummary({ operationKind: "join", rowCount: 12, columnName: "email", value: "private@example.com", position: { x: 40, y: 80 } }), {
    operationKind: "join", rowCount: 12, position: { x: 40, y: 80 },
  });
});

test("activity events identify user overrides of committed agent changes", () => {
  const agent = { sequence: 7, flowId: "flow-a", actor: "agent", status: "committed", targetType: "prepared", targetId: "prepared-a", action: "recipe_changed", summary: { enabled: false }, eventId: "agent-7" };
  const user = createActivityEvent({ flowId: "flow-a", actor: "user", action: "recipe_changed", targetType: "prepared", targetId: "prepared-a", summary: { enabled: true } });
  assert.equal(findSupersededActivity([agent], user)?.eventId, "agent-7");
  assert.equal(findSupersededActivity([agent], createActivityEvent({ flowId: "flow-a", actor: "user", action: "recipe_changed", targetType: "prepared", targetId: "prepared-a" })), null);
});

test("activity cursors return ordered incremental changes", () => {
  const events = [{ sequence: 3, actor: "user", targetId: "a" }, { sequence: 1, actor: "agent", targetId: "a" }, { sequence: 2, actor: "user", targetId: "b" }];
  assert.deepEqual(pageActivityEvents(events, { cursor: 1, limit: 1 }), {
    events: [{ sequence: 2, actor: "user", targetId: "b" }], cursor: 2, hasMore: true,
  });
  assert.deepEqual(pageActivityEvents(events, { cursor: 1, actor: "user", targetId: "a" }).events, [{ sequence: 3, actor: "user", targetId: "a" }]);
});

test("activity events record cancellation as a terminal status linked to the request", () => {
  const event = createActivityEvent({
    flowId: "flow-a",
    actor: "user",
    action: "delete_cancelled",
    targetType: "prepared-dataset",
    targetId: "prepared-a",
    requestId: "delete-request-1",
    status: "cancelled",
    supersedesEventId: "pending-event-1",
  });
  assert.equal(event.status, "cancelled");
  assert.equal(event.supersedesEventId, "pending-event-1");
  assert.equal(event.requestId, "delete-request-1");
});
