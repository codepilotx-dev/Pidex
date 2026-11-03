# ZCode model option data — provenance & license

`zcode-model-options.ts` in this directory is a generated static extract of the
ZCode built-in model-option rules.

- **Source repository:** ZCode (`D:\GitHubProject\Agent\ZCode` at authoring time; not required at runtime)
- **Source file:** `config/provider/zcode-builtin.json`
- **Source revision:** `33` (git `3c5b227649371507ddc4eb46ac5133afe6db1cab`, package version `3.16.2`)
- **License:** Apache-2.0 (ZCode root `LICENSE` and `package.json` `license: "Apache-2.0"`)
- **Extracted scope:** only the `optionSpecs` contribution of `config.modelConfigRules`
  (`modelRules`, `modelApiRules`, `providerSiteRules`) — 187 rules. Model facts not related to
  option values/maps are intentionally omitted.
- **Modifications for CodePilotX:** re-serialized as a TypeScript module, trimmed to optionSpecs,
  and wrapped with typed interfaces (`ZCodeOptionRule`). No semantic changes to the rule data.

This extract is redistributed under the Apache License, Version 2.0. A copy of the license is
available in the ZCode repository `LICENSE` file. Only this static data is reused; ZCode provider
accounts, authentication and runtime are not imported.
