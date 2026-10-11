# Upstream Source

This package is derived from the OpenCode schema package:

- Project: https://github.com/anomalyco/opencode
- Local source snapshot: `D:\GitHubProject\Agent\opencode-dev\packages\schema`
- Source files and SHA-256:
  - `model.ts`: `cd7717a4699cb24ce617f66352e77981281d0ff1af2b0f52dac8bbfd6d150e84`
  - `provider.ts`: `f72afc446470bd4ac6fadce7f880539590604052c3cb003f39a415f2adcc1834`
  - `integration.ts`: `07cdfc9f79a8f64719ed099906936eda87a188c045611af7bbe929e585dd5641`
  - `credential.ts`: `141f051d45fbb49d08b72154d5ddc4d398b87f18b106b948e67fa05a72e4bef6`
  - `connection.ts`: `37d3914dab08b851c9c5a0c0dd7e1a3c77ab6224a8802a0a00fbb178565ecaab`
- Imported on: 2026-07-14

The local source snapshot did not include Git metadata, so an upstream commit hash was not available.

Changes in this package are limited to the model/provider integration contracts needed by Pidex. Event definitions, identifier generation, and unrelated schemas were omitted. Current identifiers replace the upstream transitional `V2` names, and `Model.Ref` is limited to `providerID`, `id`, and optional `variant`.

Local implementation files are all files under `src/`.

The upstream code is licensed under the MIT License. See `LICENSE.opencode`.
