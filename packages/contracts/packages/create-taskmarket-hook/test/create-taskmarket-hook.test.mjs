import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractsRoot = path.resolve(packageRoot, "../..");
const bin = path.join(packageRoot, "bin/create-taskmarket-hook.mjs");
const address = "0x1111111111111111111111111111111111111111";
const mixedCaseAddress = "0xAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const normalizedAddress = mixedCaseAddress.toLowerCase();
const dependencyCommands = [
  "forge install --no-git daydreamsai/taskmarket-contracts@657b9f74478bdf71c3c1b5e0d2dde7197aba56cb",
  "forge install --no-git OpenZeppelin/openzeppelin-contracts@fcbae5394ae8ad52d8e580a3477db99814b9d565",
  "forge install --no-git foundry-rs/forge-std@1801b0541f4fda118a10798fd3486bb7051c5dd6",
];

async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "taskmarket-hook-"));
}
function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" });
}

test("generates a substituted, reproducible project", async (t) => {
  const cwd = await temporaryDirectory();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const result = run(
    cwd,
    "reputation-hook",
    "--taskmarket",
    mixedCaseAddress,
  );
  assert.equal(result.status, 0, result.stderr);
  const root = path.join(cwd, "reputation-hook");
  await stat(path.join(root, "foundry.toml"));
  await stat(path.join(root, "src/ReputationHook.sol"));
  await stat(path.join(root, "test/ReputationHook.t.sol"));

  const remappings = await readFile(path.join(root, "remappings.txt"), "utf8");
  assert.equal(
    remappings,
    "@taskmarket/contracts/=lib/taskmarket-contracts/\n@openzeppelin/=lib/openzeppelin-contracts/\nforge-std/=lib/forge-std/src/\n",
  );

  const deploy = await readFile(path.join(root, "script/Deploy.s.sol"), "utf8");
  assert.ok(deploy.includes(`hex"${normalizedAddress.slice(2)}"`));
  assert.doesNotMatch(deploy, new RegExp(mixedCaseAddress));

  const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^lib\/$/m);

  const hook = await readFile(
    path.join(root, "src/ReputationHook.sol"),
    "utf8",
  );
  assert.match(
    hook,
    /supportsInterface\(bytes4 interfaceId\) public pure virtual returns \(bool\)/,
  );

  const readme = await readFile(path.join(root, "README.md"), "utf8");
  for (const command of dependencyCommands) {
    assert.ok(readme.includes(command), `README missing ${command}`);
    assert.ok(result.stdout.includes(command), `next steps missing ${command}`);
  }
  assert.ok(readme.includes("set -a\n. ./.env\nset +a\nforge script"));
  assert.ok(readme.includes("forge test -j 1"));
  assert.ok(result.stdout.includes("forge test -j 1"));
  assert.match(readme, /forge script .*--verify/);
});

test("rejects invalid names and existing targets without overwriting", async (t) => {
  const cwd = await temporaryDirectory();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const invalidName of [
    "Bad_Name",
    "bad--name",
    "bad-",
    "-bad",
    "con",
  ]) {
    assert.notEqual(
      run(cwd, invalidName, "--taskmarket", address).status,
      0,
      invalidName,
    );
  }
  assert.notEqual(run(cwd, "bad-address", "--taskmarket", "0x0").status, 0);
  assert.notEqual(
    run(
      cwd,
      "bad-hook-name",
      "--taskmarket",
      address,
      "--hook-name",
      "notSolidity",
    ).status,
    0,
  );
  assert.notEqual(
    run(cwd, "unknown-option", "--taskmarket", address, "--nope", "value")
      .status,
    0,
  );
  assert.equal(run(cwd, "hook", "--taskmarket", address).status, 0);
  await stat(path.join(cwd, "hook/src/Hook.sol"));
  assert.equal(run(cwd, "safe-hook", "--taskmarket", address).status, 0);
  const generatedHook = path.join(cwd, "safe-hook/src/SafeHook.sol");
  const originalHook = await readFile(generatedHook, "utf8");
  const second = run(cwd, "safe-hook", "--taskmarket", address);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /target already exists/);
  assert.equal(await readFile(generatedHook, "utf8"), originalHook);
});

test("enforces portable path-component boundaries before writing", async (t) => {
  const cwd = await temporaryDirectory();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const longestDefaultProjectName = "a".repeat(245);
  const longestDefaultHookName = `A${"a".repeat(244)}Hook`;
  assert.equal(
    Buffer.byteLength(`${longestDefaultHookName}.t.sol`),
    255,
  );
  assert.equal(
    run(cwd, longestDefaultProjectName, "--taskmarket", address).status,
    0,
  );
  await stat(
    path.join(
      cwd,
      longestDefaultProjectName,
      "test",
      `${longestDefaultHookName}.t.sol`,
    ),
  );

  const tooLongDefaultProjectName = "a".repeat(246);
  const longRenderedPath = run(
    cwd,
    tooLongDefaultProjectName,
    "--taskmarket",
    address,
  );
  assert.notEqual(longRenderedPath.status, 0);
  assert.match(longRenderedPath.stderr, /generated path is not portable/);
  await assert.rejects(stat(path.join(cwd, tooLongDefaultProjectName)), {
    code: "ENOENT",
  });

  const tooLongProjectName = "b".repeat(256);
  const longProject = run(
    cwd,
    tooLongProjectName,
    "--taskmarket",
    address,
    "--hook-name",
    "ShortHook",
  );
  assert.notEqual(longProject.status, 0);
  assert.match(longProject.stderr, /project name is not portable/);
  assert.ok(!(await readdir(cwd)).includes(tooLongProjectName));
});

test("generated project compiles and its Foundry tests pass against this checkout", async (t) => {
  if (
    spawnSync("forge", ["--version"], { encoding: "utf8" }).error?.code ===
    "ENOENT"
  ) {
    t.skip("Foundry is not installed");
    return;
  }
  try {
    await stat(
      path.join(
        contractsRoot,
        "lib/openzeppelin-contracts/contracts/utils/introspection/IERC165.sol",
      ),
    );
    await stat(path.join(contractsRoot, "lib/forge-std/src/Test.sol"));
  } catch {
    t.skip("checkout dependencies are not installed");
    return;
  }

  const cwd = await temporaryDirectory();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const generated = run(
    cwd,
    "compiled-hook",
    "--taskmarket",
    mixedCaseAddress,
    "--hook-name",
    "CompiledHook",
  );
  assert.equal(generated.status, 0, generated.stderr);
  const root = path.join(cwd, "compiled-hook");
  const result = spawnSync(
    "forge",
    [
      "test",
      "-j",
      "1",
      "--root",
      root,
      "--no-cache",
      "-R",
      `@taskmarket/contracts/=${contractsRoot}/`,
      "-R",
      `@openzeppelin/=${contractsRoot}/lib/openzeppelin-contracts/`,
      "-R",
      `forge-std/=${contractsRoot}/lib/forge-std/src/`,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /2 passed; 0 failed/);
});
