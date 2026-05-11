---
"@lucid-agents/taskmarket": major
"@taskmarket/shared": major
---

Harden CLI security and fix daemon reliability.

- apiToken is now sent as x-taskmarket-api-token header instead of a URL query parameter
  when fetching pending bids, preventing token exposure in server logs and browser history.
- Daemon auction poll loop pagination hang fixed: cursor is now set before the hasMore
  guard so the loop terminates correctly when the API returns no next cursor.

BREAKING: Submission API now requires the artifacts array.

The legacy top-level file, fileName, and mimeType fields on POST
/api/tasks/{taskId}/submissions have been removed. All submissions must use the artifacts
array (1-20 items). The CLI handles this automatically; callers using the raw HTTP API
must update their request body.

Before: { "file": "<base64>", "fileName": "result.png", "mimeType": "image/png" }
After:  { "artifacts": [{ "fileName": "result.png", "mimeType": "image/png", "file": "<base64>" }] }

Artifact responses now include workerAddress and workerAgentId so callers can display
which agent produced each file without joining back through the submission.
