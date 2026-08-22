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
const immutable = () => fixture("valid/simple-immutable.json");
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

test("AJV requires portable slash-separated repository-relative source paths", () => {
  for (const path of [
    "",
    "/src/Hook.sol",
    "src/Hook.sol/",
    "src//Hook.sol",
    "./src/Hook.sol",
    "src/./Hook.sol",
    "../Hook.sol",
    "src/../Hook.sol",
    "C:/repo/Hook.sol",
    "C:\\repo\\Hook.sol",
    "\\\\server\\share\\Hook.sol",
    "//server/share/Hook.sol",
    "src\\Hook.sol",
    "src/\nHook.sol",
    "src/\u0001Hook.sol",
    "src/\u007fHook.sol",
  ]) {
    const manifest = immutable();
    manifest.source.path = path;
    assertSchemaInvalid(manifest, ["/source/path"]);
  }

  for (const path of ["src/Hook.sol", ".github/hooks/Hook Example.sol"]) {
    const manifest = immutable();
    manifest.source.path = path;
    assert.equal(
      validateSchema(manifest),
      true,
      `${path}: ${JSON.stringify(validateSchema.errors)}`,
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

test("AJV requires kind-specific proxy locators and concrete upgrade authority", () => {
  const roleLinked = proxy();
  delete roleLinked.proxy.admin;
  delete roleLinked.proxy.timelock;
  roleLinked.proxy.upgradeAuthorityRole = "UPGRADE_AUTHORITY_ROLE";
  assert.equal(
    validateSchema(roleLinked),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );

  const proseOnly = proxy();
  delete proseOnly.proxy.admin;
  delete proseOnly.proxy.timelock;
  delete proseOnly.proxy.upgradeAuthorityRole;
  assertSchemaInvalid(proseOnly, ["/proxy"]);

  const transparent = proxy();
  transparent.proxy.kind = "transparent";
  delete transparent.proxy.admin;
  assertSchemaInvalid(transparent, ["/proxy"]);

  const beacon = proxy();
  beacon.proxy.kind = "beacon";
  delete beacon.proxy.beacon;
  assertSchemaInvalid(beacon, ["/proxy"]);

  beacon.proxy.beacon = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal(
    validateSchema(beacon),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );

  beacon.proxy.beacon = `0x${"0".repeat(40)}`;
  assertSchemaInvalid(beacon, ["/proxy/beacon"]);

  const strayBeacon = proxy();
  strayBeacon.proxy.beacon = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assertSchemaInvalid(strayBeacon, ["/proxy/beacon"]);
});

test("AJV requires kind-aware non-vacuous external dependency evidence", () => {
  const dependency = (kind) => ({
    name: `${kind} dependency`,
    kind,
    purpose: "Required by hook execution.",
  });

  for (const kind of ["contract", "token", "oracle", "relayer"]) {
    const missing = immutable();
    missing.externalDependencies = [dependency(kind)];
    assertSchemaInvalid(missing, ["/externalDependencies/0"]);

    const empty = immutable();
    empty.externalDependencies = [{ ...dependency(kind), addresses: [] }];
    assertSchemaInvalid(empty, ["/externalDependencies/0/addresses"]);
  }

  const api = immutable();
  api.externalDependencies = [
    { ...dependency("api"), url: "https://api.example.com/v1" },
  ];
  assert.equal(
    validateSchema(api),
    true,
    JSON.stringify(validateSchema.errors, null, 2),
  );

  api.externalDependencies[0].addresses = [];
  assertSchemaInvalid(api, ["/externalDependencies/0/addresses"]);

  const apiWithoutUrl = immutable();
  apiWithoutUrl.externalDependencies = [
    {
      ...dependency("api"),
      addresses: ["0x3333333333333333333333333333333333333333"],
    },
  ];
  assertSchemaInvalid(apiWithoutUrl, ["/externalDependencies/0"]);

  for (const kind of ["other"]) {
    const byAddress = immutable();
    byAddress.externalDependencies = [
      {
        ...dependency(kind),
        addresses: ["0x3333333333333333333333333333333333333333"],
      },
    ];
    assert.equal(
      validateSchema(byAddress),
      true,
      JSON.stringify(validateSchema.errors, null, 2),
    );

    const byUrl = immutable();
    byUrl.externalDependencies = [
      { ...dependency(kind), url: "https://dependency.example.com" },
    ];
    assert.equal(
      validateSchema(byUrl),
      true,
      JSON.stringify(validateSchema.errors, null, 2),
    );

    byUrl.externalDependencies[0].addresses = [];
    assertSchemaInvalid(byUrl, ["/externalDependencies/0/addresses"]);

    const missing = immutable();
    missing.externalDependencies = [dependency(kind)];
    assertSchemaInvalid(missing, ["/externalDependencies/0"]);

    const empty = immutable();
    empty.externalDependencies = [{ ...dependency(kind), addresses: [] }];
    assertSchemaInvalid(empty, ["/externalDependencies/0/addresses"]);

    const zero = immutable();
    zero.externalDependencies = [
      { ...dependency(kind), addresses: [`0x${"0".repeat(40)}`] },
    ];
    assertSchemaInvalid(zero, ["/externalDependencies/0/addresses/0"]);
  }
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
