import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  join(import.meta.dirname, "../.github/workflows/deploy-preview.yml"),
  "utf8",
);

test("preview teardown fails closed while keeping already-absent resources idempotent", () => {
  const teardown = workflow.slice(
    workflow.indexOf("is_already_absent()"),
    workflow.indexOf("\n  deploy:"),
  );

  assert.match(
    teardown,
    /not\[\[:space:\]_-\]\?found\|does not exist\|already deleted/,
  );
  assert.match(
    teardown,
    /railway service delete[\s\S]*?still failing after 20 attempts[\s\S]*?return 1/,
  );
  assert.match(
    teardown,
    /railway environment delete[\s\S]*?still failing after 20 attempts[\s\S]*?return 1/,
  );
  assert.match(
    teardown,
    /delete_service "\$ANVIL_SERVICE_NAME" \|\| exit 1[\s\S]*?delete_service "\$FACILITATOR_SERVICE_NAME" \|\| exit 1[\s\S]*?delete_service "\$STORYBOOK_SERVICE_NAME" \|\| exit 1[\s\S]*?delete_environment \|\| exit 1/,
  );
});
