---
"@lucid-agents/taskmarket": patch
---

`task download` without `--output` now strips terminal control and escape bytes (including ANSI/VT100 sequences and OSC 52 clipboard writes) from downloaded text before printing it, so a malicious file can no longer execute terminal commands or overwrite your clipboard just by being downloaded. Downloaded content that isn't valid UTF-8 text is no longer printed at all -- use `--output <path>` to save binary content to a file instead.
