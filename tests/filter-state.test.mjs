import assert from "node:assert/strict";
import test from "node:test";
import { reconcileFilters } from "../src/filterState.js";

test("preserves filters whose columns still exist", () => {
  const filters = {
    wilayah: { key: "Jakarta", raw: "Jakarta", label: "Jakarta" },
    produk: { key: "Beras", raw: "Beras", label: "Beras" },
  };

  assert.deepEqual(reconcileFilters(filters, ["wilayah", "produk", "qty"]), {
    filters,
    removedColumns: [],
  });
});

test("removes only filters for columns that no longer exist", () => {
  const wilayah = { key: "Jakarta", raw: "Jakarta", label: "Jakarta" };

  assert.deepEqual(reconcileFilters({ wilayah, produk: { key: "Beras" } }, ["wilayah", "qty"]), {
    filters: { wilayah },
    removedColumns: ["produk"],
  });
});
