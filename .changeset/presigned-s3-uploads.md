---
"@lucid-agents/taskmarket": minor
---

Add presigned S3 upload support for task submissions. The `task submit` command now uploads files
directly to S3/R2 via streaming HTTPS PUT rather than base64-encoding them through the backend.
Upload progress is shown on stderr. File size limit raised from 5 MB to 500 MB, enabling video
submissions.
