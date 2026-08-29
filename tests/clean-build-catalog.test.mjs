import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createStep, CREATABLE_TRANSFORMATION_TYPES } from "../src/transformations.js";

const appSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/App.jsx"), "utf8");
const stylesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles.css"), "utf8");

test("Clean/Build catalog opens without a dead toolbar menu setter", () => {
  assert.equal(/\bsetOpenMenu\b/.test(appSource), false);
  assert.match(appSource, /setColumnMenuOpen\(false\)/);
  assert.match(appSource, /setTransformPopover\(/);
});

test("available Clean/Build tools can create a bound step from the catalog", () => {
  assert.deepEqual(CREATABLE_TRANSFORMATION_TYPES.map((item) => item.type), [
    "trim",
    "standardize-case",
    "parse-date",
    "remove-columns",
  ]);

  const trim = createStep("trim", { column: "wilayah", mode: "both" });
  const normalizeCase = createStep("standardize-case", { column: "wilayah", mode: "lower" });
  assert.equal(trim.type, "trim");
  assert.equal(trim.params.column, "wilayah");
  assert.equal(normalizeCase.type, "standardize-case");
  assert.notEqual(trim.id, normalizeCase.id);
});

test("tool picker renders one ordered list without Clean or Build headings", () => {
  assert.match(appSource, /CREATABLE_TRANSFORMATION_TYPES\.map\(\(item\)/);
  assert.doesNotMatch(appSource, /group === "Clean"/);
  assert.doesNotMatch(appSource, /\["Clean", "Build"\]\.map/);
});

test("value rows expose direct keep and delete context actions", () => {
  assert.match(appSource, /onContextMenu=\{\(event\) => openValueMenu\(event, item\)\}/);
  assert.match(appSource, /commitValueAction\("keep"\)/);
  assert.match(appSource, /commitValueAction\("delete"\)/);
});

test("workspace flow and local file handles persist across refresh", () => {
  assert.match(appSource, /\bloadStoredFlow\b/);
  assert.match(appSource, /\bsaveStoredFlow\b/);
  assert.match(appSource, /\bloadStoredSourceHandle\b/);
  assert.match(appSource, /\bsaveStoredSourceHandle\b/);
  assert.match(appSource, /\brestoreFileFromHandle\b/);
  assert.match(appSource, /onRelinkSource/);
});

test("Formula column is grouped beside Choose columns in the aggregate heading", () => {
  const aggregateHeading = appSource.indexOf('<header className="aggregate-heading">');
  const formulaTrigger = appSource.indexOf('className="aggregate-heading__button aggregate-heading__button--formula"', aggregateHeading);
  const columnPicker = appSource.indexOf('<div className="column-picker"', aggregateHeading);

  assert.ok(aggregateHeading >= 0);
  assert.ok(formulaTrigger > aggregateHeading);
  assert.ok(columnPicker > formulaTrigger);
  assert.doesNotMatch(appSource, /className="toolbar-actions"/);
});

test("embedded Steps keeps its header fixed and scrolls only the recipe list", () => {
  assert.match(stylesSource, /\.sidebar-steps-host\s*\{[^}]*height:\s*0;[^}]*flex:\s*1 1 0;/s);
  assert.match(stylesSource, /\.steps-panel--embedded\s*\{[^}]*min-height:\s*0;[^}]*max-height:\s*100%;/s);
  assert.match(stylesSource, /\.steps-list\s*\{[^}]*flex:\s*1 1 0;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
  assert.match(stylesSource, /\.steps-list\s*>\s*\.step-card\s*\{[^}]*flex:\s*0 0 auto;/s);
});
