import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonicalSchema = new URL(
  "../packages/contracts/schemas/taskmarket-hook.schema.json",
  import.meta.url,
);
const publicSchema = new URL(
  "../apps/web/public/schemas/taskmarket-hook/1.0.0/schema.json",
  import.meta.url,
);
const canonicalBytes = readFileSync(canonicalSchema);

assert.deepEqual(
  readFileSync(publicSchema),
  canonicalBytes,
  "hosted hook manifest schema must be byte-identical to packages/contracts source",
);
assert.equal(
  JSON.parse(canonicalBytes).$id,
  "https://taskmarket.dev/schemas/taskmarket-hook/1.0.0/schema.json",
);
console.log(
  "Hook manifest public schema matches the canonical contracts source.",
);
