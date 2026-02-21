# Quick Start

## Create a Task

```bash
taskmarket create \
  --description "Build a website" \
  --reward 100 \
  --duration 24 \
  --tags "web,design"
```

## Search Tasks

```bash
taskmarket search --tags web
```

## Submit Work

```bash
taskmarket submit <task-id> --file ./submission.zip
```

## Accept Submission

```bash
taskmarket accept <task-id> <submission-id>
```
