#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(
  readFileSync(
    new URL("../../schemas/taskmarket-hook.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function displayPath(instancePath) {
  return instancePath
    .split("/")
    .slice(1)
    .reduce((path, encodedSegment) => {
      const segment = encodedSegment
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
      if (/^(0|[1-9][0-9]*)$/.test(segment)) return `${path}[${segment}]`;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment))
        return `${path}.${segment}`;
      return `${path}[${JSON.stringify(segment)}]`;
    }, "$");
}

function formatSchemaError(error) {
  let path = displayPath(error.instancePath);
  if (error.keyword === "required") path += `.${error.params.missingProperty}`;
  if (error.keyword === "additionalProperties")
    path += `.${error.params.additionalProperty}`;
  return `${path}: ${error.message}`;
}

function normalizedEffectiveHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

function checkSemanticConsistency(manifest, errors) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  )
    return;
  const deployments = Array.isArray(manifest.deployments)
    ? manifest.deployments
    : [];
  const chainIds = deployments
    .filter((item) => item && Number.isInteger(item.chainId))
    .map((item) => item.chainId);
  const declaredChains = new Set(chainIds);
  chainIds.forEach((chainId, index) => {
    if (chainIds.indexOf(chainId) !== index)
      errors.push(`$.deployments[${index}].chainId: must be unique`);
  });

  const callbacks = Array.isArray(manifest.callbacks) ? manifest.callbacks : [];
  const estimates = manifest.gas?.estimates;
  if (estimates && typeof estimates === "object" && !Array.isArray(estimates)) {
    callbacks.forEach((callback) => {
      if (!Object.hasOwn(estimates, callback))
        errors.push(
          `$.gas.estimates.${callback}: missing estimate for declared callback`,
        );
    });
    Object.keys(estimates).forEach((callback) => {
      if (!callbacks.includes(callback))
        errors.push(
          `$.gas.estimates.${callback}: estimate is not for a declared callback`,
        );
      const estimate = estimates[callback];
      if (
        estimate &&
        Number.isInteger(estimate.typical) &&
        Number.isInteger(estimate.maximum) &&
        estimate.maximum < estimate.typical
      ) {
        errors.push(
          `$.gas.estimates.${callback}.maximum: must be greater than or equal to typical`,
        );
      }
    });
  }

  const privilegedRoles = Array.isArray(manifest.privilegedRoles)
    ? manifest.privilegedRoles
    : [];
  const proxy = manifest.proxy;
  if (proxy?.upgradeable === true) {
    const holderAddresses = new Set(
      privilegedRoles.flatMap((role) =>
        Array.isArray(role?.holders)
          ? role.holders
              .filter((holder) => typeof holder === "string")
              .map((holder) => holder.toLowerCase())
          : [],
      ),
    );
    for (const field of ["admin", "timelock"]) {
      const address = proxy[field];
      if (
        typeof address === "string" &&
        !holderAddresses.has(address.toLowerCase())
      ) {
        errors.push(`$.proxy.${field}: must appear in privilegedRoles holders`);
      }
    }

    const upgradeAuthorityRole = proxy.upgradeAuthorityRole;
    if (typeof upgradeAuthorityRole === "string") {
      const matches = privilegedRoles.filter(
        (role) => role?.name === upgradeAuthorityRole,
      );
      if (
        matches.length !== 1 ||
        !Array.isArray(matches[0]?.holders) ||
        matches[0].holders.length === 0
      ) {
        errors.push(
          "$.proxy.upgradeAuthorityRole: must reference exactly one privilegedRoles entry with holders",
        );
      }
    }
  }

  const verifiers = manifest.sourceVerification?.verifiers;
  if (Array.isArray(verifiers)) {
    const evidenceKeys = new Map();
    verifiers.forEach((verifier, index) => {
      if (
        verifier &&
        Number.isInteger(verifier.chainId) &&
        !declaredChains.has(verifier.chainId)
      ) {
        errors.push(
          `$.sourceVerification.verifiers[${index}].chainId: must reference a declared deployment`,
        );
      }
      if (
        verifier &&
        Number.isInteger(verifier.chainId) &&
        typeof verifier.url === "string"
      ) {
        const normalizedUrl = normalizedEffectiveHttpsUrl(verifier.url);
        if (normalizedUrl !== null) {
          const key = JSON.stringify([verifier.chainId, normalizedUrl]);
          if (evidenceKeys.has(key)) {
            errors.push(
              `$.sourceVerification.verifiers[${index}].url: duplicates chainId and normalized URL from verifier ${evidenceKeys.get(key)}`,
            );
          } else {
            evidenceKeys.set(key, index);
          }
        }
      }
    });
  }

  const protocolDefault = manifest.protocolDefault;
  if (protocolDefault && Array.isArray(protocolDefault.chains)) {
    protocolDefault.chains.forEach((chainId, index) => {
      if (Number.isInteger(chainId) && !declaredChains.has(chainId)) {
        errors.push(
          `$.protocolDefault.chains[${index}]: must reference a declared deployment`,
        );
      }
    });
    const uniqueChains = new Set(protocolDefault.chains);
    if (
      protocolDefault.status === "default-on-all-declared-chains" &&
      (uniqueChains.size !== declaredChains.size ||
        [...declaredChains].some((chainId) => !uniqueChains.has(chainId)))
    ) {
      errors.push(
        "$.protocolDefault.chains: must contain every declared deployment chain",
      );
    }
    if (
      protocolDefault.status === "default-on-some-chains" &&
      uniqueChains.size >= declaredChains.size
    ) {
      errors.push(
        "$.protocolDefault.chains: must be a strict subset of declared deployment chains",
      );
    }
  }
}

function isDraft(manifest) {
  return (
    Object.hasOwn(manifest, "x-draft") &&
    manifest["x-draft"] !== false &&
    manifest["x-draft"] !== null
  );
}

export function inspect(manifest) {
  validateSchema(manifest);
  const errors = (validateSchema.errors ?? []).map(formatSchemaError);
  checkSemanticConsistency(manifest, errors);
  if (
    manifest !== null &&
    typeof manifest === "object" &&
    !Array.isArray(manifest)
  ) {
    if (isDraft(manifest)) {
      errors.push("$.x-draft: draft manifests are not publishable");
    }
  }
  const uniqueErrors = [...new Set(errors)];
  return { errors: uniqueErrors, publishable: uniqueErrors.length === 0 };
}

export function validate(manifest) {
  return inspect(manifest).errors;
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedAsScript) {
  const file = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
  if (!file) {
    console.error(
      "Usage: node tools/hook-manifest/validate.mjs <taskmarket-hook.json>",
    );
    process.exitCode = 2;
  } else {
    try {
      const errors = validate(JSON.parse(readFileSync(file, "utf8")));
      if (errors.length) {
        console.error(
          `Invalid ${file}:\n${errors.map((error) => `- ${error}`).join("\n")}`,
        );
        process.exitCode = 1;
      } else {
        console.log(`Valid ${file}`);
      }
    } catch (error) {
      console.error(`Invalid ${file}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
