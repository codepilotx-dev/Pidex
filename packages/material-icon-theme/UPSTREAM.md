# Upstream

- Project: [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
- npm package: `material-icon-theme@5.37.0`
- Imported: 2026-07-20
- npm tarball: `https://registry.npmjs.org/material-icon-theme/-/material-icon-theme-5.37.0.tgz`
- npm shasum (SHA-1): `72d9db71ce881c74203a484548d9053ada359a19`
- Tarball SHA-256: `fb4aca5932084f2d8112dbfbec40cf8c0fd24da4b90d16845cd2686682816377`
- License: MIT; preserved in `LICENSE`

`scripts/SyncUpstream.ts` reads the pinned package from a local
`node_modules/material-icon-theme` when available, otherwise downloads and
verifies the pinned npm tarball. It derives the VS Code file/folder association
tables and one monochrome `currentColor` React component for every upstream
icon definition.

Run `bun run sync` to refresh generated files and `bun run sync:check` to verify
that committed output is current.
