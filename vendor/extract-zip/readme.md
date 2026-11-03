# extract-zip (Pidex maintained)

This directory vendors `extract-zip@2.0.1` under its BSD-2-Clause license and
publishes it inside this repository as `2.0.2-pidex.1`.

The Pidex revision rejects absolute symlink targets and relative symlink
targets that resolve outside the extraction root before calling `fs.symlink`.
It addresses CVE-2026-56876 / GHSA-jmr9-qjv8-65gv without changing the public
CommonJS API, CLI, extraction modes, or `onEntry` callback.

Pidex also adds an optional synchronous `filter(entry)` callback. Returning
`false` skips the entry before creating directories or extracting its contents;
throwing aborts extraction. Plugin installation uses this to validate the archive
and extract only the selected plugin. Existing callers retain the same behavior.

## JS API

```javascript
const extract = require('extract-zip')

await extract(source, {
  dir: target,
  onEntry: (entry, zipfile) => {
    // Optional caller validation.
  }
})
```

Options retained from upstream:

- `dir` (required, absolute target directory)
- `defaultDirMode`
- `defaultFileMode`
- `onEntry(entry, zipfile)`

## CLI

```text
extract-zip archive.zip <targetDirectory>
```
