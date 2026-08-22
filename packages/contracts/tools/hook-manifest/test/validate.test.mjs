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
const multiChain = () => fixture("valid/multi-chain-proxies.json");
const portalReady = () => fixture("valid/portal-ready.json");
const errorsFor = (manifest, expectedPath) => {
  const errors = validate(manifest);
  assert.ok(
    errors.some((error) => error.includes(expectedPath)),
    `expected ${expectedPath} in:\n${errors.join("\n")}`,
  );
  return errors;
};

test("valid immutable, proxy, multi-chain, and portal-ready fixtures validate", () => {
  assert.deepEqual(validate(immutable()), []);
  assert.deepEqual(validate(proxy()), []);
  assert.deepEqual(validate(multiChain()), []);
  assert.deepEqual(validate(portalReady()), []);
});

test("bundled invalid fixtures reject their intended fields", () => {
  errorsFor(fixture("invalid/bad-address.json"), "$.deployments[0].hook");
  const errors = validate(fixture("invalid/ambiguous-status.json"));
  for (const path of [
    "$.callbacks[0]",
    "$.hookData",
    "$.deployments[0].proxy.kind",
  ]) {
    assert.ok(
      errors.some((error) => error.includes(path)),
      `expected ${path} in:\n${errors.join("\n")}`,
    );
  }

  const singletonErrors = validate(
    fixture("invalid/multi-chain-singleton-proxy.json"),
  );
  for (const path of [
    "$.proxy",
    "$.deployments[0].proxy",
    "$.deployments[1].proxy",
  ]) {
    assert.ok(
      singletonErrors.some((error) => error.includes(path)),
      `expected ${path} in:\n${singletonErrors.join("\n")}`,
    );
  }

  errorsFor(
    fixture("invalid/dependency-undeclared-chain.json"),
    "$.externalDependencies[0].deployments[0].chainId",
  );
  const duplicateErrors = validate(
    fixture("invalid/dependency-duplicate-bindings.json"),
  );
  for (const path of [
    "$.externalDependencies[0].deployments[0].addresses[1]",
    "$.externalDependencies[0].deployments[1].chainId",
  ]) {
    assert.ok(
      duplicateErrors.some((error) => error.includes(path)),
      `expected ${path} in:\n${duplicateErrors.join("\n")}`,
    );
  }

  const legacyErrors = validate(
    fixture("invalid/legacy-global-runtime-evidence.json"),
  );
  for (const path of [
    "$.gas",
    "$.deployments[0].gas",
    "$.deployments[1].gas",
    "$.externalDependencies[0].addresses",
    "$.externalDependencies[0].url",
    "$.externalDependencies[0].deployments",
  ]) {
    assert.ok(
      legacyErrors.some((error) => error.includes(path)),
      `expected ${path} in:\n${legacyErrors.join("\n")}`,
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

test("CLI rejects non-portable, absolute, traversing, and control-bearing source paths", () => {
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
    errorsFor(manifest, "$.source.path");
  }

  const portable = immutable();
  portable.source.path = ".github/hooks/Hook Example.sol";
  assert.deepEqual(validate(portable), []);
});

test("rejects non-HTTPS schemes for every externally rendered URL", () => {
  const manifest = proxy();
  manifest.author.url = "http://example.com/author";
  manifest.source.repository = "javascript:alert(1)";
  manifest.sourceVerification.verifiers[0].url = "data:text/html,unsafe";
  manifest.externalDependencies[0].deployments[0].url =
    "http://example.com/oracle";
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
    "$.externalDependencies[0].deployments[0].url",
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

test("CLI requires a nonempty HTTPS authority", () => {
  for (const url of [
    "https:example.com",
    "https:/example.com",
    "https:///example.com",
  ]) {
    const manifest = proxy();
    manifest.author.url = url;
    errorsFor(manifest, "$.author.url");
  }

  for (const url of [
    "https://example.com",
    "https://EXAMPLE.com:443/source?view=code#L1",
  ]) {
    const manifest = proxy();
    manifest.author.url = url;
    assert.deepEqual(validate(manifest), []);
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
  upgradeableNone.deployments[0].proxy = {
    kind: "none",
    upgradeable: true,
    implementation: "0x3333333333333333333333333333333333333333",
    upgradeAuthorityDescription: "owner",
  };
  errorsFor(upgradeableNone, "$.deployments[0].proxy.kind");

  const immutableWithAdmin = immutable();
  immutableWithAdmin.deployments[0].proxy.admin =
    "0x3333333333333333333333333333333333333333";
  errorsFor(immutableWithAdmin, "$.deployments[0].proxy.admin");

  const proseOnly = proxy();
  delete proseOnly.deployments[0].proxy.admin;
  delete proseOnly.deployments[0].proxy.timelock;
  delete proseOnly.deployments[0].proxy.upgradeAuthorityRole;
  errorsFor(proseOnly, "$.deployments[0].proxy");

  const transparentWithoutAdmin = proxy();
  transparentWithoutAdmin.deployments[0].proxy.kind = "transparent";
  delete transparentWithoutAdmin.deployments[0].proxy.admin;
  errorsFor(transparentWithoutAdmin, "$.deployments[0].proxy.admin");

  const beaconWithoutBeacon = proxy();
  beaconWithoutBeacon.deployments[0].proxy.kind = "beacon";
  errorsFor(beaconWithoutBeacon, "$.deployments[0].proxy.beacon");

  const validBeacon = proxy();
  validBeacon.deployments[0].proxy.kind = "beacon";
  validBeacon.deployments[0].proxy.beacon =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.deepEqual(validate(validBeacon), []);

  const roleLinked = proxy();
  delete roleLinked.deployments[0].proxy.admin;
  delete roleLinked.deployments[0].proxy.timelock;
  assert.deepEqual(validate(roleLinked), []);

  const unknownRole = structuredClone(roleLinked);
  unknownRole.deployments[0].proxy.upgradeAuthorityRole = "UNKNOWN_ROLE";
  errorsFor(unknownRole, "$.deployments[0].proxy.upgradeAuthorityRole");

  const duplicateRole = structuredClone(roleLinked);
  duplicateRole.privilegedRoles.push(
    structuredClone(duplicateRole.privilegedRoles[0]),
  );
  errorsFor(duplicateRole, "$.deployments[0].proxy.upgradeAuthorityRole");

  const emptyRole = structuredClone(roleLinked);
  emptyRole.privilegedRoles[0].holders = [];
  errorsFor(emptyRole, "$.deployments[0].proxy.upgradeAuthorityRole");

  const unlistedAdmin = proxy();
  unlistedAdmin.deployments[0].proxy.admin =
    "0x3333333333333333333333333333333333333333";
  errorsFor(unlistedAdmin, "$.deployments[0].proxy.admin");

  const unlistedTimelock = proxy();
  unlistedTimelock.deployments[0].proxy.timelock =
    "0x4444444444444444444444444444444444444444";
  errorsFor(unlistedTimelock, "$.deployments[0].proxy.timelock");

  const malformed = immutable();
  malformed.deployments[0].proxy = { kind: "unknown", upgradeable: "yes" };
  errorsFor(malformed, "$.deployments[0].proxy.kind");
  errorsFor(malformed, "$.deployments[0].proxy.upgradeable");
});

test("validates proxy authority independently for every deployment", () => {
  const manifest = multiChain();
  assert.notEqual(
    manifest.deployments[0].proxy.implementation,
    manifest.deployments[1].proxy.implementation,
  );
  assert.notEqual(
    manifest.deployments[0].proxy.admin,
    manifest.deployments[1].proxy.admin,
  );
  assert.deepEqual(validate(manifest), []);

  manifest.deployments[1].proxy.admin =
    "0x9999999999999999999999999999999999999999";
  errorsFor(manifest, "$.deployments[1].proxy.admin");
});

test("validates chain-bound role holders, role names, and normalized holder pairs", () => {
  const wrongChain = proxy();
  wrongChain.privilegedRoles[0].holders[0].chainId = 84532;
  errorsFor(wrongChain, "$.privilegedRoles[0].holders[0].chainId");
  errorsFor(wrongChain, "$.deployments[0].proxy.admin");

  const duplicateHolder = proxy();
  duplicateHolder.privilegedRoles[0].holders.push({
    chainId: 8453,
    address: "0x7777777777777777777777777777777777777777"
      .toUpperCase()
      .replace("0X", "0x"),
  });
  errorsFor(duplicateHolder, "$.privilegedRoles[0].holders[2].address");

  const duplicateName = proxy();
  duplicateName.privilegedRoles.push({
    ...structuredClone(duplicateName.privilegedRoles[1]),
    holders: [
      {
        chainId: 8453,
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  });
  errorsFor(duplicateName, "$.privilegedRoles[2].name");

  const duplicateCapability = proxy();
  duplicateCapability.privilegedRoles[0].capabilities.push(
    duplicateCapability.privilegedRoles[0].capabilities[0],
  );
  errorsFor(duplicateCapability, "$.privilegedRoles[0].capabilities");
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

  const missingChainCoverage = immutable();
  const secondDeployment = structuredClone(missingChainCoverage.deployments[0]);
  secondDeployment.chainId = 84532;
  secondDeployment.hook = "0x3333333333333333333333333333333333333333";
  missingChainCoverage.deployments.push(secondDeployment);
  const coverageErrors = errorsFor(
    missingChainCoverage,
    "$.sourceVerification.verifiers",
  );
  assert.ok(
    coverageErrors.some((error) =>
      error.includes("$.deployments[1].chainId (84532)"),
    ),
    coverageErrors.join("\n"),
  );
});

test("rejects duplicate verifier evidence by normalized effective HTTPS URL", () => {
  const duplicateError =
    "$.sourceVerification.verifiers[1].url: duplicates chainId and normalized URL from verifier 0";

  for (const [firstUrl, secondUrl] of [
    [
      "https://verifier.example.com/source",
      "https://verifier.example.com/source",
    ],
    [
      "https://Verifier.Example.com:443/contracts/../source",
      "https://verifier.example.com/source",
    ],
    ["https://verifier.example.com", "https://verifier.example.com/"],
  ]) {
    const manifest = proxy();
    manifest.sourceVerification.verifiers[0].url = firstUrl;
    manifest.sourceVerification.verifiers[1].url = secondUrl;
    assert.deepEqual(validate(manifest), [duplicateError]);
  }

  const emptyAuthorityAlias = proxy();
  emptyAuthorityAlias.sourceVerification.verifiers[0].url =
    "https://verifier.example.com/source";
  emptyAuthorityAlias.sourceVerification.verifiers[1].url =
    "https:///verifier.example.com/source";
  const errors = errorsFor(
    emptyAuthorityAlias,
    "$.sourceVerification.verifiers[1].url",
  );
  assert.ok(errors.includes(duplicateError), errors.join("\n"));

  for (const [firstUrl, secondUrl] of [
    [
      "https://verifier.example.com/source?view=source",
      "https://verifier.example.com/source?view=bytecode",
    ],
    [
      "https://verifier.example.com/source#L1",
      "https://verifier.example.com/source#L2",
    ],
  ]) {
    const distinct = proxy();
    distinct.sourceVerification.verifiers[0].url = firstUrl;
    distinct.sourceVerification.verifiers[1].url = secondUrl;
    assert.deepEqual(validate(distinct), []);
  }

  const differentChains = immutable();
  differentChains.sourceVerification.verifiers[0].url =
    "https://verifier.example.com/";
  differentChains.deployments.push({
    ...structuredClone(differentChains.deployments[0]),
    chainId: 1,
    network: "Ethereum",
  });
  differentChains.sourceVerification.verifiers.push({
    chainId: 1,
    url: "https://Verifier.Example.com:443",
    status: "verified",
  });
  assert.deepEqual(validate(differentChains), []);
});

test("validates privileged roles, dependencies, liveness, and security details", () => {
  const manifest = proxy();
  manifest.privilegedRoles[0] = {
    name: "",
    holders: [{ chainId: 8453, address: "0x12" }],
    capabilities: [""],
    renounceable: "no",
  };
  manifest.externalDependencies[0] = {
    name: "",
    kind: "unknown",
    purpose: "",
    deployments: [{ chainId: 8453, addresses: ["0x12"], url: "bad uri" }],
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
    "$.privilegedRoles[0].holders[0].address",
    "$.privilegedRoles[0].capabilities[0]",
    "$.privilegedRoles[0].renounceable",
    "$.externalDependencies[0].name",
    "$.externalDependencies[0].kind",
    "$.externalDependencies[0].deployments[0].addresses[0]",
    "$.externalDependencies[0].deployments[0].url",
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

test("requires kind-aware non-vacuous external dependency locators", () => {
  const dependency = (kind) => ({
    name: `${kind} dependency`,
    kind,
    purpose: "Required by hook execution.",
  });
  const binding = (fields = {}) => ({ chainId: 8453, ...fields });

  for (const kind of ["contract", "token", "oracle", "relayer"]) {
    const missing = immutable();
    missing.externalDependencies = [dependency(kind)];
    errorsFor(missing, "$.externalDependencies[0].deployments");

    const empty = immutable();
    empty.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [binding({ addresses: [] })],
      },
    ];
    errorsFor(empty, "$.externalDependencies[0].deployments[0].addresses");

    const zero = immutable();
    zero.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [binding({ addresses: [`0x${"0".repeat(40)}`] })],
      },
    ];
    errorsFor(zero, "$.externalDependencies[0].deployments[0].addresses[0]");
  }

  const api = immutable();
  api.externalDependencies = [
    {
      ...dependency("api"),
      deployments: [binding({ url: "https://api.example.com/v1" })],
    },
  ];
  assert.deepEqual(validate(api), []);

  api.externalDependencies[0].deployments[0].addresses = [
    "0x3333333333333333333333333333333333333333",
  ];
  errorsFor(api, "$.externalDependencies[0].deployments[0].addresses");

  const apiWithoutUrl = immutable();
  apiWithoutUrl.externalDependencies = [
    {
      ...dependency("api"),
      deployments: [
        binding({
          addresses: ["0x3333333333333333333333333333333333333333"],
        }),
      ],
    },
  ];
  errorsFor(apiWithoutUrl, "$.externalDependencies[0].deployments[0].url");

  for (const kind of ["other"]) {
    const byAddress = immutable();
    byAddress.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [
          binding({
            addresses: ["0x3333333333333333333333333333333333333333"],
          }),
        ],
      },
    ];
    assert.deepEqual(validate(byAddress), []);

    const byUrl = immutable();
    byUrl.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [binding({ url: "https://dependency.example.com" })],
      },
    ];
    assert.deepEqual(validate(byUrl), []);

    byUrl.externalDependencies[0].deployments[0].addresses = [];
    errorsFor(byUrl, "$.externalDependencies[0].deployments[0].addresses");

    const missing = immutable();
    missing.externalDependencies = [
      { ...dependency(kind), deployments: [binding()] },
    ];
    errorsFor(missing, "$.externalDependencies[0].deployments[0]");

    const empty = immutable();
    empty.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [binding({ addresses: [] })],
      },
    ];
    errorsFor(empty, "$.externalDependencies[0].deployments[0].addresses");

    const zero = immutable();
    zero.externalDependencies = [
      {
        ...dependency(kind),
        deployments: [binding({ addresses: [`0x${"0".repeat(40)}`] })],
      },
    ];
    errorsFor(zero, "$.externalDependencies[0].deployments[0].addresses[0]");
  }
});

test("validates dependency names and deployment bindings with indexed paths", () => {
  const valid = multiChain();
  assert.deepEqual(validate(valid), []);

  const sameAddressOnDifferentChains = multiChain();
  sameAddressOnDifferentChains.externalDependencies[0].deployments[1].addresses[0] =
    sameAddressOnDifferentChains.externalDependencies[0].deployments[0].addresses[0];
  assert.deepEqual(validate(sameAddressOnDifferentChains), []);

  const duplicateName = multiChain();
  duplicateName.externalDependencies.push(
    structuredClone(duplicateName.externalDependencies[0]),
  );
  errorsFor(duplicateName, "$.externalDependencies[1].name");

  errorsFor(
    fixture("invalid/dependency-undeclared-chain.json"),
    "$.externalDependencies[0].deployments[0].chainId",
  );

  const duplicate = fixture("invalid/dependency-duplicate-bindings.json");
  errorsFor(duplicate, "$.externalDependencies[0].deployments[0].addresses[1]");
  errorsFor(duplicate, "$.externalDependencies[0].deployments[1].chainId");
});

test("requires gas estimates to match callbacks exactly and orders bounds", () => {
  const missing = immutable();
  delete missing.deployments[0].gas.estimates.checkClaim;
  errorsFor(missing, "$.deployments[0].gas.estimates.checkClaim");

  const extra = immutable();
  extra.deployments[0].gas.estimates.onExpire = {
    typical: 1,
    maximum: 2,
    methodology: "fixture",
  };
  errorsFor(extra, "$.deployments[0].gas.estimates.onExpire");

  const reversed = immutable();
  reversed.deployments[0].gas.estimates.checkFund = {
    typical: 10,
    maximum: 9,
    methodology: "fixture",
  };
  errorsFor(reversed, "$.deployments[0].gas.estimates.checkFund.maximum");

  const missingOnSecondDeployment = multiChain();
  delete missingOnSecondDeployment.deployments[1].gas.estimates.checkFund;
  errorsFor(
    missingOnSecondDeployment,
    "$.deployments[1].gas.estimates.checkFund",
  );
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
  twoChains.sourceVerification = { status: "unverified", verifiers: [] };
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
  manifest.deployments[0].proxy.implementation = zeroAddress;
  manifest.deployments[0].proxy.admin = zeroAddress;
  manifest.deployments[0].proxy.timelock = zeroAddress;
  manifest.privilegedRoles[0].holders[0].address = zeroAddress;
  manifest.externalDependencies[0].deployments[0].addresses[0] = zeroAddress;
  manifest.deployments[0].gas.estimates.checkFund.typical = 0;
  manifest.deployments[0].gas.estimates.checkFund.maximum = 0;
  const errors = validate(manifest);
  for (const path of [
    "$.source.commit",
    "$.deployments[0].hook",
    "$.deployments[0].taskmarketDiamond",
    "$.deployments[0].deployment.transactionHash",
    "$.deployments[0].deployment.blockNumber",
    "$.deployments[0].runtimeCodehash",
    "$.deployments[0].creationCodehash",
    "$.deployments[0].proxy.implementation",
    "$.deployments[0].proxy.admin",
    "$.deployments[0].proxy.timelock",
    "$.privilegedRoles[0].holders[0].address",
    "$.externalDependencies[0].deployments[0].addresses[0]",
    "$.deployments[0].gas.estimates.checkFund.typical",
    "$.deployments[0].gas.estimates.checkFund.maximum",
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
  draft.deployments[0].gas.estimates.checkFund.typical = 0;
  draft.deployments[0].gas.estimates.checkFund.maximum = 0;
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
