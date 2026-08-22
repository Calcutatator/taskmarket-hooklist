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

function isSafePositiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isSafeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
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
  const declaredChains = new Set();
  const firstDeploymentByChain = new Map();
  deployments.forEach((deployment, deploymentIndex) => {
    const chainId = deployment?.chainId;
    if (!isSafePositiveInteger(chainId)) return;
    declaredChains.add(chainId);
    if (firstDeploymentByChain.has(chainId)) {
      errors.push(
        `$.deployments[${deploymentIndex}].chainId: duplicates deployment chainId from deployment ${firstDeploymentByChain.get(chainId)}`,
      );
    } else {
      firstDeploymentByChain.set(chainId, deploymentIndex);
    }
  });

  const callbacks = Array.isArray(manifest.callbacks) ? manifest.callbacks : [];
  deployments.forEach((deployment, deploymentIndex) => {
    const estimates = deployment?.gas?.estimates;
    if (!estimates || typeof estimates !== "object" || Array.isArray(estimates))
      return;
    callbacks.forEach((callback) => {
      if (!Object.hasOwn(estimates, callback)) {
        errors.push(
          `$.deployments[${deploymentIndex}].gas.estimates.${callback}: missing estimate for declared callback`,
        );
      }
    });
    Object.keys(estimates).forEach((callback) => {
      if (!callbacks.includes(callback)) {
        errors.push(
          `$.deployments[${deploymentIndex}].gas.estimates.${callback}: estimate is not for a declared callback`,
        );
      }
      const estimate = estimates[callback];
      if (
        estimate &&
        isSafeNonnegativeInteger(estimate.typical) &&
        isSafeNonnegativeInteger(estimate.maximum) &&
        estimate.maximum < estimate.typical
      ) {
        errors.push(
          `$.deployments[${deploymentIndex}].gas.estimates.${callback}.maximum: must be greater than or equal to typical`,
        );
      }
    });
  });

  const privilegedRoles = Array.isArray(manifest.privilegedRoles)
    ? manifest.privilegedRoles
    : [];
  const roleNameIndexes = new Map();
  const holderAddressesByChain = new Set();
  privilegedRoles.forEach((role, roleIndex) => {
    const roleName = role?.name;
    if (typeof roleName === "string") {
      if (roleNameIndexes.has(roleName)) {
        errors.push(
          `$.privilegedRoles[${roleIndex}].name: duplicates role name from privileged role ${roleNameIndexes.get(roleName)}`,
        );
      } else {
        roleNameIndexes.set(roleName, roleIndex);
      }
    }

    const holders = Array.isArray(role?.holders) ? role.holders : [];
    const holderIndexes = new Map();
    holders.forEach((holder, holderIndex) => {
      const chainId = holder?.chainId;
      const address = holder?.address;
      if (isSafePositiveInteger(chainId) && !declaredChains.has(chainId)) {
        errors.push(
          `$.privilegedRoles[${roleIndex}].holders[${holderIndex}].chainId: must reference a declared deployment`,
        );
      }
      if (isSafePositiveInteger(chainId) && typeof address === "string") {
        const key = JSON.stringify([chainId, address.toLowerCase()]);
        if (holderIndexes.has(key)) {
          errors.push(
            `$.privilegedRoles[${roleIndex}].holders[${holderIndex}].address: duplicates normalized chainId and address from holder ${holderIndexes.get(key)}`,
          );
        } else {
          holderIndexes.set(key, holderIndex);
        }
        holderAddressesByChain.add(key);
      }
    });
  });

  deployments.forEach((deployment, deploymentIndex) => {
    const proxy = deployment?.proxy;
    if (proxy?.upgradeable !== true) return;
    for (const field of ["admin", "timelock"]) {
      const address = proxy[field];
      if (
        typeof address === "string" &&
        isSafePositiveInteger(deployment?.chainId) &&
        !holderAddressesByChain.has(
          JSON.stringify([deployment.chainId, address.toLowerCase()]),
        )
      ) {
        errors.push(
          `$.deployments[${deploymentIndex}].proxy.${field}: must appear in privilegedRoles holders for deployment chain ${deployment.chainId}`,
        );
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
        !matches[0].holders.some(
          (holder) => holder?.chainId === deployment?.chainId,
        )
      ) {
        errors.push(
          `$.deployments[${deploymentIndex}].proxy.upgradeAuthorityRole: must reference exactly one privilegedRoles entry with holders for deployment chain ${deployment?.chainId}`,
        );
      }
    }
  });

  const externalDependencies = Array.isArray(manifest.externalDependencies)
    ? manifest.externalDependencies
    : [];
  const dependencyNameIndexes = new Map();
  externalDependencies.forEach((dependency, dependencyIndex) => {
    const dependencyName = dependency?.name;
    if (typeof dependencyName === "string") {
      if (dependencyNameIndexes.has(dependencyName)) {
        errors.push(
          `$.externalDependencies[${dependencyIndex}].name: duplicates dependency name from external dependency ${dependencyNameIndexes.get(dependencyName)}`,
        );
      } else {
        dependencyNameIndexes.set(dependencyName, dependencyIndex);
      }
    }

    const bindings = Array.isArray(dependency?.deployments)
      ? dependency.deployments
      : [];
    const bindingIndexes = new Map();
    bindings.forEach((binding, bindingIndex) => {
      const chainId = binding?.chainId;
      if (isSafePositiveInteger(chainId)) {
        if (!declaredChains.has(chainId)) {
          errors.push(
            `$.externalDependencies[${dependencyIndex}].deployments[${bindingIndex}].chainId: must reference a declared deployment`,
          );
        }
        if (bindingIndexes.has(chainId)) {
          errors.push(
            `$.externalDependencies[${dependencyIndex}].deployments[${bindingIndex}].chainId: duplicates chainId from deployment binding ${bindingIndexes.get(chainId)}`,
          );
        } else {
          bindingIndexes.set(chainId, bindingIndex);
        }
      }

      const addresses = Array.isArray(binding?.addresses)
        ? binding.addresses
        : [];
      const addressIndexes = new Map();
      addresses.forEach((address, addressIndex) => {
        if (typeof address !== "string") return;
        const normalizedAddress = address.toLowerCase();
        if (addressIndexes.has(normalizedAddress)) {
          errors.push(
            `$.externalDependencies[${dependencyIndex}].deployments[${bindingIndex}].addresses[${addressIndex}]: duplicates normalized address from address ${addressIndexes.get(normalizedAddress)}`,
          );
        } else {
          addressIndexes.set(normalizedAddress, addressIndex);
        }
      });
    });
  });

  const verifiers = manifest.sourceVerification?.verifiers;
  if (Array.isArray(verifiers)) {
    const evidenceKeys = new Map();
    verifiers.forEach((verifier, index) => {
      if (
        verifier &&
        isSafePositiveInteger(verifier.chainId) &&
        !declaredChains.has(verifier.chainId)
      ) {
        errors.push(
          `$.sourceVerification.verifiers[${index}].chainId: must reference a declared deployment`,
        );
      }
      if (
        verifier &&
        isSafePositiveInteger(verifier.chainId) &&
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

    if (
      !isDraft(manifest) &&
      manifest.sourceVerification?.status === "verified"
    ) {
      const verifiedChains = new Set(
        verifiers
          .filter(
            (verifier) =>
              isSafePositiveInteger(verifier?.chainId) &&
              verifier?.status === "verified",
          )
          .map((verifier) => verifier.chainId),
      );
      deployments.forEach((deployment, deploymentIndex) => {
        if (
          isSafePositiveInteger(deployment?.chainId) &&
          !verifiedChains.has(deployment.chainId)
        ) {
          errors.push(
            `$.sourceVerification.verifiers: must include verified evidence for $.deployments[${deploymentIndex}].chainId (${deployment.chainId})`,
          );
        }
      });
    }
  }

  const protocolDefault = manifest.protocolDefault;
  if (protocolDefault && Array.isArray(protocolDefault.chains)) {
    protocolDefault.chains.forEach((chainId, index) => {
      if (isSafePositiveInteger(chainId) && !declaredChains.has(chainId)) {
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
