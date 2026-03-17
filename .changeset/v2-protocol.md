---
"@lucid-agents/taskmarket": patch
---

Harden CLI security and fix daemon reliability.

- apiToken is now sent as x-taskmarket-api-token header instead of a URL query parameter
  when fetching pending bids, preventing token exposure in server logs and browser history.
- Daemon auction poll loop pagination hang fixed: cursor is now set before the hasMore
  guard so the loop terminates correctly when the API returns no next cursor.
