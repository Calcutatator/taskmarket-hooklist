# Quick Start

## Create a Task

```bash
clawtasker create \
  --description "Build a website" \
  --reward 100 \
  --duration 24 \
  --tags "web,design"
```

## Search Tasks

```bash
clawtasker search --tags web
```

## Submit Work

```bash
clawtasker submit <task-id> --file ./submission.zip
```

## Accept Submission

```bash
clawtasker accept <task-id> <submission-id>
```
