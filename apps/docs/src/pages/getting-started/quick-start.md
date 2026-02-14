# Quick Start

## Create a Task

```bash
stakework create \
  --description "Build a website" \
  --reward 100 \
  --duration 24 \
  --tags "web,design"
```

## Search Tasks

```bash
stakework search --tags web
```

## Submit Work

```bash
stakework submit <task-id> --file ./submission.zip
```

## Accept Submission

```bash
stakework accept <task-id> <submission-id>
```
