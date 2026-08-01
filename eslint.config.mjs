import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  //
  // ⚠️ RESTATING THESE REPLACES THE DEFAULTS RATHER THAN ADDING TO THEM, so
  // anything this project generates has to be listed here or it gets linted.
  // Before the `.open-next`/`.wrangler` entries below, `npm run lint` reported
  // 22,446 problems and 750 errors — every one of them inside a bundle
  // produced by `build:cf`, none of them in code anybody wrote. A gate that
  // is 750 errors red on a clean tree is a gate nobody can use, which is why
  // this is a lint config change and not a lint cleanup.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and local state this project generates:
    ".open-next/**",
    ".wrangler/**",
    // Bundler stubs — not source, and one of them parses as binary.
    "scripts/stubs/**",
  ]),
  {
    // custom-worker.ts imports two modules that DO NOT EXIST until a build
    // has run: ./.open-next/worker.js, emitted by `build:cf`, and the resvg
    // .wasm, which only wrangler knows how to resolve. So the TS error is
    // real before a build and gone after one — which is the one case the
    // "expect-error" directive cannot express, because after a build it
    // would report itself as an unused directive and fail the typecheck
    // instead. The suppressing directive that file uses is the correct one,
    // so the rule is switched off for that file rather than the directive
    // being swapped for a wrong one.
    //
    // (Naming the other directive in a comment here is enough to trip the
    // same rule on THIS file, which is why it is described rather than
    // written out.)
    files: ["custom-worker.ts"],
    rules: { "@typescript-eslint/ban-ts-comment": "off" },
  },
]);

export default eslintConfig;
