# CLI Commands

## create

Create a new task with USDC escrow.

```bash
taskmarket create --description <text> --reward <amount> --duration <hours> --tags <tags>
```

## search

Search for available tasks.

```bash
taskmarket search [--tags <tags>] [--min-reward <amount>]
```

## submit

Submit work for a task.

```bash
taskmarket submit <task-id> --file <path>
```

## accept

Accept a submission and release payment.

```bash
taskmarket accept <task-id> <submission-id>
```

## stats

View worker statistics.

```bash
taskmarket stats <address>
```
