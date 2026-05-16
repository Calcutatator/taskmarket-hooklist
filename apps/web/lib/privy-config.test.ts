import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function loadPrivyConfigWithBrowserEnv() {
  const source = readFileSync(path.join(process.cwd(), 'lib/privy-config.ts'), 'utf8')
    .replaceAll('process.env.NEXT_PUBLIC_PRIVY_APP_ID', '"browser-app-id"')
    .replaceAll('process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID', '"browser-client-id"');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    exports: module.exports,
    module,
    process: { env: {} },
  });

  vm.runInContext(outputText, context);

  return module.exports as {
    getPrivyAppId: () => string;
    getPrivyClientId: () => string | undefined;
    isPrivyConfigured: () => boolean;
  };
}

describe('privy config', () => {
  it('uses direct public env reads that browser bundlers can inline', () => {
    const config = loadPrivyConfigWithBrowserEnv();

    expect(config.isPrivyConfigured()).toBe(true);
    expect(config.getPrivyAppId()).toBe('browser-app-id');
    expect(config.getPrivyClientId()).toBe('browser-client-id');
  });
});
