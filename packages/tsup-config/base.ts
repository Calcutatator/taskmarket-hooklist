import type { Options } from "tsup";
import { defineConfig } from "tsup";

const baseOptions: Partial<Options> = {
  format: ["esm"],
  sourcemap: true,
  clean: true,
  target: "es2022",
  treeshake: true,
  splitting: false,
  skipNodeModulesBundle: true,
  outDir: "dist",
};

export function definePackageConfig(options: Options | Options[]) {
  const withDefaults = (option: Options): Options => ({
    ...baseOptions,
    dts: option.dts ?? true,
    ...option,
  });

  if (Array.isArray(options)) {
    return defineConfig(options.map(withDefaults));
  }

  return defineConfig(withDefaults(options));
}
