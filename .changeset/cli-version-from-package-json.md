---
'@lucid-agents/taskmarket': patch
---

CLI version is now read from `package.json` at runtime instead of being hardcoded.
`taskmarket --version` will always reflect the installed npm package version.
