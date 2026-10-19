import { expect, it } from "vitest";
import { autosaveDelay } from "../lib/useWorkspaceAutosave";

it("retries a failed autosave with capped exponential backoff instead of stopping for good", () => {
  expect(autosaveDelay("saved", null, 0)).toBe(1000);
  expect(autosaveDelay("saving", null, 0)).toBeNull();
  expect(autosaveDelay("error", 500, 1)).toBe(2000);
  expect(autosaveDelay("error", null, 3)).toBe(8000);
  expect(autosaveDelay("error", 500, 20)).toBe(60_000);
});
it("does not retry a revision conflict from another window", () => {
  expect(autosaveDelay("error", 409, 1)).toBeNull();
});
