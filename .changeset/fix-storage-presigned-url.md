---
'@lucid-agents/taskmarket': patch
---

Fix `task download` — presigned URL now resolves correctly.

The storage backend stored file URLs as `s3://bucket/key` URIs. When generating
presigned URLs, the full URI was passed as the S3 key instead of just the relative
path, resulting in 404 errors. The `getPresignedUrl` method now strips the
`s3://bucket/` prefix before signing.
