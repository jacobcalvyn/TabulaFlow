import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WEBMCP_DISPATCH_ACTIONS,
  WEBMCP_STABLE_TOOL_NAMES,
} from "../src/useWebMcpTools.js";
import { WEBMCP_CONTRACT_VERSION } from "../src/webMcpRuntime.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("hackathon repository exposes current license and product documentation", async () => {
  const [license, readme, architecture, demo, hackathon, packageJson] = await Promise.all([
    readFile(projectFile("LICENSE"), "utf8"),
    readFile(projectFile("README.md"), "utf8"),
    readFile(projectFile("docs/WEBMCP.md"), "utf8"),
    readFile(projectFile("docs/DEMO.md"), "utf8"),
    readFile(projectFile("docs/HACKATHON.md"), "utf8"),
    readFile(projectFile("package.json"), "utf8").then(JSON.parse),
  ]);

  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.equal(packageJson.license, "Apache-2.0");
  assert.match(readme, /https:\/\/tabulaflow\.jacobcalvyn\.chatgpt\.site/);
  assert.match(readme, /docs\/WEBMCP\.md/);
  assert.match(readme, /docs\/DEMO\.md/);
  assert.match(readme, /docs\/HACKATHON\.md/);
  assert.doesNotMatch(readme, /next architectural milestone is Compose/i);
  assert.match(readme, /not uploaded automatically/i);
  assert.match(architecture, /document\.modelContext\.registerTool\(\)/);
  assert.match(demo, /does not use DOM selectors or simulated clicks/i);
  assert.match(hackathon, /Development evidence/);
});

test("hackathon documentation matches the stable WebMCP contract surface", async () => {
  const [readme, architecture] = await Promise.all([
    readFile(projectFile("README.md"), "utf8"),
    readFile(projectFile("docs/WEBMCP.md"), "utf8"),
  ]);
  const actionRouteCount = Object.values(WEBMCP_DISPATCH_ACTIONS)
    .reduce((total, actions) => total + Object.keys(actions).length, 0);

  assert.equal(WEBMCP_CONTRACT_VERSION, "3.3.0");
  assert.equal(WEBMCP_STABLE_TOOL_NAMES.length, 17);
  assert.equal(actionRouteCount, 60);
  for (const content of [readme, architecture]) {
    assert.match(content, /contract(?: version)?:?\s*`?3\.3\.0`?/i);
    assert.match(content, /17 stable/i);
    assert.match(content, /60 action/i);
  }
});

test("judging fixture is deterministic, balanced, and free of direct contact data", async () => {
  const csv = await readFile(projectFile("examples/webmcp-demo.csv"), "utf8");
  const [header, ...rows] = csv.trim().split("\n");
  const columns = header.split(",");
  const records = rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row.split(",")[index]])));
  const services = records.reduce((groups, record) => {
    (groups[record.service] ??= []).push(record);
    return groups;
  }, {});
  const average = (group) => group.reduce((total, record) => total + Number(record.actual_weight_kg), 0) / group.length;

  assert.equal(new Set(columns).size, 8);
  assert.equal(records.length, 24);
  assert.deepEqual(Object.fromEntries(Object.entries(services).map(([service, group]) => [service, group.length])), {
    EXPRESS: 8,
    REGULAR: 8,
    ECONOMY: 8,
  });
  assert.ok(Math.abs(average(services.EXPRESS) - 1.3125) < Number.EPSILON * 10);
  assert.ok(Math.abs(average(services.REGULAR) - 0.875) < Number.EPSILON * 10);
  assert.ok(Math.abs(average(services.ECONOMY) - 0.4875) < Number.EPSILON * 10);
  assert.equal(columns.some((column) => /email|phone|telephone|mobile|address|contact/i.test(column)), false);
  assert.doesNotMatch(csv, /@[a-z0-9.-]+/i);
});
