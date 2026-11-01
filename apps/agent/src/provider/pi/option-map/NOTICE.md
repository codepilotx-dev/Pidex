# NOTICE — ported restricted CEL / JSON Merge Patch module

This directory (`apps/agent/src/provider/pi/option-map/`) is a port of the
`packages/model-option-map` package from the ZCode reference repository.

- Upstream source: `D:\GitHubProject\Agent\ZCode\packages\model-option-map`
- Upstream revision: `3c5b227649371507ddc4eb46ac5133afe6db1cab`
  ("chore: sync ZCode source", 2026-10-20)
- Upstream files ported: `src/types.ts`, `src/tokenizer.ts`, `src/parser.ts`,
  `src/evaluator.ts`, `src/compiler.ts`, `src/merge-patch.ts`,
  `src/option-maps.ts`, `src/index.ts`
- Upstream license: Apache License, Version 2.0 (ZCode repository root `LICENSE`;
  upstream `package.json` `license: "Apache-2.0"`).
- Copyright: the ZCode authors. Licensed under the Apache License, Version 2.0.
  A copy of the license is available in this repository's root `LICENSE`.

## Modifications for CodePilotX

- ESM `.js` import specifiers removed to match the repository bundler style
  (extensionless relative imports).
- `ModelOptionValues.reasoningLevel` is modeled as optional to reflect the
  fail-closed runtime check when a declared reasoning map has no effective value.
- Added a barrel that also re-exports the tokenizer/parser/evaluator internals.
- Ported tests live in `apps/agent/test/option-map/` (rewritten for `bun:test`),
  plus one extra case asserting illegal expressions are rejected at compile time
  with a safe error that leaks no filesystem paths or credentials.
- No runtime `eval`, `Function`, or dynamic code loading is used.
