import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspect, validate } from "../validate.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(resolve("tools/hook-manifest/fixtures", name), "utf8"),
  );
const immutable = () => fixture("valid/simple-immutable.json");
const proxy = () => fixture("valid/advanced-proxy.json");
const portalReady = () => fixture("valid/portal-ready.json");
const errorsFor = (manifest, expectedPath) => {
  const errors = validate(manifest);
  assert.ok(
    errors.some((error) => error.includes(expectedPath)),
    `expected ${expectedPath} in:\n${errors.join("\n")}`,
  );
  return errors;
};

test("valid immutable, proxy, and portal-ready fixtures validate", () => {
  assert.deepEqual(validate(immutable()), []);
  assert.deepEqual(validate(proxy()), []);
  assert.deepEqual(validate(portalReady()), []);
});

test("bundled invalid fixtures reject their intended fields", () => {
  errorsFor(fixture("invalid/bad-address.json"), "$.deployments[0].hook");
  const errors = validate(fixture("invalid/ambiguous-status.json"));
  for (const path of ["$.callbacks[0]", "$.hookData", "$.proxy.kind"]) {
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
  }
});

test("enforces nested strings, formats, hashes, enums, and unknown properties", () => {
  const manifest = immutable();
  manifest.identity.name = "";
  manifest.author.url = "not a URI";
  manifest.author.contact = "not-an-email";
  manifest.deployments[0].creationCodehash = "0x12";
  manifest.listing.unpublishedField = true;
  const errors = validate(manifest);
  for (const path of [
    "$.identity.name",
    "$.author.url",
    "$.author.contact",
    "$.deployments[0].creationCodehash",
    "$.listing.unpublishedField",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
  }
});

test("rejects non-HTTPS schemes for every externally rendered URL", () => {
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
  const errors = validate(manifest);
  for (const path of [
    "$.author.url",
    "$.source.repository",
    "$.sourceVerification.verifiers[0].url",
    "$.externalDependencies[0].url",
    "$.security.audits[0].report",
    "$.listing.listingUrl",
    "$.conformance.evidence",
    "$.protocolDefault.evidence",
  ])
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
});

test("CLI uses canonical standard formats for malformed HTTPS URIs and emails", () => {
  const manifest = proxy();
  manifest.author.url = "https://example.com/%";
  manifest.author.contact = "a@b";
  const errors = validate(manifest);
  for (const path of ["$.author.url", "$.author.contact"]) {
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
  }
});

test("allows x-* only at schema extension points", () => {
  const allowed = immutable();
  allowed["x-publisher"] = { id: 1 };
  allowed.identity["x-display"] = "compact";
  allowed.deployments[0]["x-explorer"] = "custom";
  assert.deepEqual(validate(allowed), []);

  const rejected = immutable();
  rejected.source["x-repository-kind"] = "git";
  rejected.deployments[0].deployment["x-confirmations"] = 100;
  errorsFor(rejected, "$.source.x-repository-kind");
  errorsFor(rejected, "$.deployments[0].deployment.x-confirmations");
});

test("validates ABI and none hookData examples completely", () => {
  const abi = proxy();
  abi.hookData.examples[0].name = "";
  abi.hookData.examples[0].encoded = "0x0";
  abi.hookData.examples[0].unexpected = true;
  let errors = validate(abi);
  for (const path of [
    "$.hookData.examples[0].name",
    "$.hookData.examples[0].encoded",
    "$.hookData.examples[0].unexpected",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
  }

  const none = immutable();
  none.hookData.abiType = "bytes";
  none.hookData.examples[0].decoded = {};
  errors = validate(none);
  assert.ok(errors.some((error) => error.includes("$.hookData.abiType")));
  assert.ok(
    errors.some((error) => error.includes("$.hookData.examples[0].decoded")),
  );
});

test("rejects contradictory proxy declarations and validates authority fields", () => {
  const upgradeableNone = immutable();
  upgradeableNone.proxy = {
    kind: "none",
    upgradeable: true,
    implementation: "0x3333333333333333333333333333333333333333",
    upgradeAuthorityDescription: "owner",
  };
  errorsFor(upgradeableNone, "$.proxy.kind");

  const immutableWithAdmin = immutable();
  immutableWithAdmin.proxy.admin = "0x3333333333333333333333333333333333333333";
  errorsFor(immutableWithAdmin, "$.proxy.admin");

  const malformed = immutable();
  malformed.proxy = { kind: "unknown", upgradeable: "yes" };
  errorsFor(malformed, "$.proxy.kind");
  errorsFor(malformed, "$.proxy.upgradeable");
});

test("requires source-verification evidence consistent with its status", () => {
  const verified = immutable();
  verified.sourceVerification.verifiers = [];
  errorsFor(verified, "$.sourceVerification.verifiers");

  const partial = proxy();
  partial.sourceVerification.verifiers =
    partial.sourceVerification.verifiers.slice(0, 1);
  errorsFor(partial, "$.sourceVerification.verifiers");

  const unverified = immutable();
  unverified.sourceVerification.status = "unverified";
  errorsFor(unverified, "$.sourceVerification.verifiers[0].status");

  const notApplicable = immutable();
  notApplicable.sourceVerification.status = "not-applicable";
  errorsFor(notApplicable, "$.sourceVerification.verifiers");

  const invalidEntry = immutable();
  invalidEntry.sourceVerification.verifiers[0] = {
    chainId: 1,
    url: "bad uri",
    status: "bogus",
    extra: true,
  };
  const errors = validate(invalidEntry);
  for (const path of [".chainId", ".url", ".status", ".extra"]) {
    assert.ok(
      errors.some((error) =>
        error.includes(`$.sourceVerification.verifiers[0]${path}`),
      ),
    );
  }
});

test("validates privileged roles, dependencies, liveness, and security details", () => {
  const manifest = proxy();
  manifest.privilegedRoles[0] = {
    name: "",
    holders: ["0x12"],
    capabilities: [""],
    renounceable: "no",
  };
  manifest.externalDependencies[0] = {
    name: "",
    kind: "unknown",
    addresses: ["0x12"],
    url: "bad uri",
    purpose: "",
  };
  manifest.liveness.failureMode = "";
  manifest.security.audits[0] = {
    status: "complete",
    scope: "",
    report: "bad uri",
    date: "2025-02-30",
  };
  manifest.security.notes = [""];
  const errors = validate(manifest);
  for (const path of [
    "$.privilegedRoles[0].name",
    "$.privilegedRoles[0].holders[0]",
    "$.privilegedRoles[0].capabilities[0]",
    "$.privilegedRoles[0].renounceable",
    "$.externalDependencies[0].name",
    "$.externalDependencies[0].kind",
    "$.externalDependencies[0].addresses[0]",
    "$.externalDependencies[0].url",
    "$.externalDependencies[0].purpose",
    "$.liveness.failureMode",
    "$.security.audits[0].status",
    "$.security.audits[0].scope",
    "$.security.audits[0].report",
    "$.security.audits[0].date",
    "$.security.notes[0]",
  ])
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
});

test("requires gas estimates to match callbacks exactly and orders bounds", () => {
  const missing = immutable();
  delete missing.gas.estimates.checkClaim;
  errorsFor(missing, "$.gas.estimates.checkClaim");

  const extra = immutable();
  extra.gas.estimates.onExpire = {
    typical: 1,
    maximum: 2,
    methodology: "fixture",
  };
  errorsFor(extra, "$.gas.estimates.onExpire");

  const reversed = immutable();
  reversed.gas.estimates.checkFund = {
    typical: 10,
    maximum: 9,
    methodology: "fixture",
  };
  errorsFor(reversed, "$.gas.estimates.checkFund.maximum");
});

test("requires default evidence and deployment-consistent chain sets", () => {
  const missingEvidence = immutable();
  missingEvidence.protocolDefault = {
    status: "default-on-all-declared-chains",
  };
  errorsFor(missingEvidence, "$.protocolDefault");

  const undeclared = immutable();
  undeclared.protocolDefault = {
    status: "default-on-all-declared-chains",
    evidence: "https://example.com/evidence",
    chains: [1],
  };
  errorsFor(undeclared, "$.protocolDefault.chains[0]");

  const twoChains = immutable();
  const secondDeployment = structuredClone(twoChains.deployments[0]);
  secondDeployment.chainId = 84532;
  secondDeployment.hook = "0x3333333333333333333333333333333333333333";
  twoChains.deployments.push(secondDeployment);
  twoChains.protocolDefault = {
    status: "default-on-some-chains",
    evidence: "https://example.com/evidence",
    chains: [8453],
  };
  assert.deepEqual(validate(twoChains), []);

  twoChains.protocolDefault = {
    status: "default-on-all-declared-chains",
    evidence: "https://example.com/evidence",
    chains: [8453],
  };
  errorsFor(twoChains, "$.protocolDefault.chains");
});

test("requires evidence URLs for affirmative trust and candidate claims", () => {
  for (const status of ["submitted", "listed"]) {
    const manifest = portalReady();
    manifest.listing = { status };
    errorsFor(manifest, "$.listing");
  }
  for (const status of ["tested", "independently-verified"]) {
    const manifest = portalReady();
    manifest.conformance = { status, standard: "ITMPHook / ERC-8195" };
    errorsFor(manifest, "$.conformance");
  }

  const audited = portalReady();
  audited.security.audits[0] = {
    status: "audited",
    scope: "Hook implementation",
  };
  errorsFor(audited, "$.security.audits[0]");

  const candidate = portalReady();
  candidate.protocolDefault = { status: "candidate" };
  errorsFor(candidate, "$.protocolDefault");
});

test("rejects duplicate deployment chain IDs", () => {
  const manifest = immutable();
  manifest.deployments.push(structuredClone(manifest.deployments[0]));
  errorsFor(manifest, "$.deployments[1].chainId");
});

test("rejects placeholder publication evidence in otherwise schema-valid manifests", () => {
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
  const errors = validate(manifest);
  for (const path of [
    "$.source.commit",
    "$.deployments[0].hook",
    "$.deployments[0].taskmarketDiamond",
    "$.deployments[0].deployment.transactionHash",
    "$.deployments[0].deployment.blockNumber",
    "$.deployments[0].runtimeCodehash",
    "$.deployments[0].creationCodehash",
    "$.proxy.implementation",
    "$.proxy.admin",
    "$.proxy.timelock",
    "$.privilegedRoles[0].holders[0]",
    "$.externalDependencies[0].addresses[0]",
    "$.gas.estimates.checkFund.typical",
    "$.gas.estimates.checkFund.maximum",
  ])
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
});

test("draft manifests with portal placeholders are never reported publishable", () => {
  const draft = portalReady();
  draft.source.commit = "0000000";
  draft.deployments[0].hook = `0x${"0".repeat(40)}`;
  draft.deployments[0].deployment.transactionHash = `0x${"0".repeat(64)}`;
  draft.deployments[0].deployment.blockNumber = 0;
  draft.deployments[0].runtimeCodehash = `0x${"0".repeat(64)}`;
  draft.gas.estimates.checkFund.typical = 0;
  draft.gas.estimates.checkFund.maximum = 0;
  draft["x-draft"] = { warning: "Draft output from the portal." };
  const result = inspect(draft);
  assert.equal(result.publishable, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes("$.x-draft: draft manifests are not publishable"),
    ),
  );

  draft["x-draft"] = false;
  assert.ok(
    validate(draft).some((error) => error.includes("$.deployments[0].hook")),
  );
});

test("draft affirmative claims may await evidence but cannot be mistaken for publishable", () => {
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
    warning: "Draft output from the portal.",
    missing: ["trust evidence"],
  };
  assert.deepEqual(validate(draft), [
    "$.x-draft: draft manifests are not publishable",
  ]);

  delete draft["x-draft"];
  const errors = validate(draft);
  for (const path of [
    "$.sourceVerification.verifiers",
    "$.listing",
    "$.conformance",
    "$.security.audits[0]",
    "$.protocolDefault",
  ])
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
});

test("documents ABI hookData as structurally checked publisher-attested metadata", () => {
  const docs = readFileSync(
    new URL("../../../docs/taskmarket-hook-manifest.md", import.meta.url),
    "utf8",
  );
  assert.match(docs, /publisher-attested metadata/i);
  assert.match(docs, /independently ABI-decode/i);
  assert.doesNotMatch(docs, /validator proves.*ABI/i);
});
