---
"@lucid-agents/taskmarket": patch
---

The JSON failure envelope now arrives intact when stderr is piped.

Piping a failing command into another program -- `taskmarket task create ... 2>&1 | jq` -- could deliver a truncated envelope, or none at all, because the CLI ended the process before the write had finished reaching the pipe. The envelope was complete on a terminal and complete when redirected to a file, so the loss only showed up in exactly the setup a script or agent uses.

The field this mattered most for is `pending`, which says whether a failed write may still be landing. A script that cannot read it cannot tell a retry from a second payment. Failing commands still exit with status 1.
