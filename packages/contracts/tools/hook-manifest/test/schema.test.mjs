import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  readFileSync(
    new URL("../../../schemas/taskmarket-hook.schema.json", import.meta.url),
    "utf8",
  ),
);
const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );
const proxy = () => fixture("valid/advanced-proxy.json");
const portalReady = () => fixture("valid/portal-ready.json");
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function assertSchemaInvalid(manifest, expectedPaths) {
  assert.equal(validateSchema(manifest), false);
  const errors = validateSchema.errors ?? [];
  for (const path of expectedPaths) {
    assert.ok(
      errors.some((error) => error.instancePath === path),
      `expected AJV error at ${path}:\n${JSON.stringify(errors, null, 2)}`,
    );
  }
}

function placeholderProxy() {
  const manifest = proxy();
  const zeroAddress = `0x${"0".repeat(40)}`;
  const zeroHash = `0x${"0".repeat(64)}`;
  manifest.source.commit = "0000000";
  manifest.deployments[0].hook = zeroAddress;
  manifest.deployments[0].taskmarketDiamond = zeroAddress;
  manifest.deployments[0].deployment.transactionHash = zeroHash;
  manifest.deployments[0].deployment.blockNumber = 0;
  manifest.deployments[0].runtimeCodehash = zeroHash;
  manifest.deployments[0].creationCodehash = zeroHash;
  manifest.proxy.implementation = zeroAddress;
  manifest.proxy.admin = zeroAddress;
  manifest.proxy.timelock = zeroAddress;
  manifest.privilegedRoles[0].holders[0] = zeroAddress;
  manifest.externalDependencies[0].addresses[0] = zeroAddress;
  manifest.gas.estimates.checkFund.typical = 0;
  manifest.gas.estimates.checkFund.maximum = 0;
  return manifest;
}

test("canonical schema compiles with the exact strict Ajv 2020 configuration", () => {
  const strictAjv = new Ajv2020({ strict: true });
  addFormats(strictAjv);
  assert.doesNotThrow(() => strictAjv.compile(schema));
});

test("AJV validates all ready fixtures against the canonical Draft 2020-12 schema", () => {
  for (const name of [
    "valid/simple-immutable.json",
    "valid/advanced-proxy.json",
    "valid/portal-ready.json",
  ]) {
    const manifest = fixture(name);
    assert.equal(
      validateSchema(manifest),
      true,
      JSON.stringify(validateSchema.errors, null, 2),
    );
  }
});

test("AJV rejects every placeholder evidence branch in a published manifest", () => {
  assertSchemaInvalid(placeholderProxy(), [
    "/source/commit",
    "/deployments/0/hook",
    "/deployments/0/taskmarketDiamond",
    "/deployments/0/deployment/transactionHash",
    "/deployments/0/deployment/blockNumber",
    "/deployments/0/runtimeCodehash",
    "/deployments/0/creationCodehash",
    "/proxy/implementation",
    "/proxy/admin",
    "/proxy/timelock",
    "/privilegedRoles/0/holders/0",
    "/externalDependencies/0/addresses/0",
    "/gas/estimates/checkFund/typical",
    "/gas/estimates/checkFund/maximum",
  ]);
});

test("AJV conditionally permits portal placeholders only with explicit non-publishable draft status", () => {
  const draft = placeholderProxy();
  draft["x-draft"] = {
    warning: "This file is a draft and must not be published.",
    missing: ["deployment evidence"],
  };
  assert.equal(
    validateSchema(draft),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );
  assert.ok(
    schema.properties["x-draft"].description.includes("never publishable"),
  );

  draft["x-draft"] = false;
  assertSchemaInvalid(draft, ["/source/commit", "/deployments/0/hook"]);
});

test("AJV permits missing affirmative evidence only while the manifest is an explicit draft", () => {
  const draft = portalReady();
  draft.sourceVerification = { status: "verified", verifiers: [] };
  draft.listing = { status: "submitted" };
  draft.conformance = { status: "tested", standard: "ITMPHook / ERC-8195" };
  draft.security.audits[0] = {
    status: "audited",
    scope: "Hook implementation",
  };
  draft.protocolDefault = { status: "candidate" };
  draft["x-draft"] = {
    warning: "This file is a draft and must not be published.",
    missing: ["trust evidence"],
  };
  assert.equal(
    validateSchema(draft),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );

  delete draft["x-draft"];
  assertSchemaInvalid(draft, [
    "/sourceVerification/verifiers",
    "/listing",
    "/conformance",
    "/security/audits/0",
    "/protocolDefault",
  ]);
});

test("AJV requires evidence URLs for affirmative trust and default claims", () => {
  for (const status of ["submitted", "listed"]) {
    const manifest = portalReady();
    manifest.listing = { status };
    assertSchemaInvalid(manifest, ["/listing"]);
  }
  for (const status of ["tested", "independently-verified"]) {
    const manifest = portalReady();
    manifest.conformance = { status, standard: "ITMPHook / ERC-8195" };
    assertSchemaInvalid(manifest, ["/conformance"]);
  }

  const audited = portalReady();
  audited.security.audits[0] = {
    status: "audited",
    scope: "Hook implementation",
  };
  assertSchemaInvalid(audited, ["/security/audits/0"]);

  const candidate = portalReady();
  candidate.protocolDefault = { status: "candidate" };
  assertSchemaInvalid(candidate, ["/protocolDefault"]);
});

test("AJV rejects HTTP and executable schemes for externally rendered URLs", () => {
  const manifest = proxy();
  manifest.author.url = "http://example.com/author";
  manifest.source.repository = "javascript:alert(1)";
  manifest.sourceVerification.verifiers[0].url = "data:text/html,unsafe";
  manifest.externalDependencies[0].url = "http://example.com/oracle";
  manifest.security.audits[0] = {
    status: "audited",
    scope: "Hook implementation",
    report: "javascript:alert(1)",
  };
  manifest.listing.listingUrl = "data:text/html,unsafe";
  manifest.conformance.evidence = "http://example.com/tests";
  manifest.protocolDefault.evidence = "javascript:alert(1)";
  assertSchemaInvalid(manifest, [
    "/author/url",
    "/source/repository",
    "/sourceVerification/verifiers/0/url",
    "/externalDependencies/0/url",
    "/security/audits/0/report",
    "/listing/listingUrl",
    "/conformance/evidence",
    "/protocolDefault/evidence",
  ]);
});

test("AJV standard formats reject malformed HTTPS URIs and short-form emails", () => {
  const manifest = proxy();
  manifest.author.url = "https://example.com/%";
  manifest.author.contact = "a@b";
  assertSchemaInvalid(manifest, ["/author/url", "/author/contact"]);
});

test("SemVer prerelease numeric identifiers reject leading zeroes", () => {
  for (const version of [
    "1.0.0-0",
    "1.0.0-alpha.0",
    "1.0.0-0A.01a",
    "1.0.0+001",
  ]) {
    const manifest = portalReady();
    manifest.identity.version = version;
    assert.equal(
      validateSchema(manifest),
      true,
      `${version}: ${JSON.stringify(validateSchema.errors)}`,
    );
  }
  for (const version of ["1.0.0-01", "1.0.0-alpha.01", "1.0.0-00"]) {
    const manifest = portalReady();
    manifest.identity.version = version;
    assertSchemaInvalid(manifest, ["/identity/version"]);
  }
});
