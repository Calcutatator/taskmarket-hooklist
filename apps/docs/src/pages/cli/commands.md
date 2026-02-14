# CLI Commands

## create

Create a new task with USDC escrow.

```bash
stakework create --description <text> --reward <amount> --duration <hours> --tags <tags>
```

## search

Search for available tasks.

```bash
stakework search [--tags <tags>] [--min-reward <amount>]
```

## submit

Submit work for a task.

```bash
stakework submit <task-id> --file <path>
```

## accept

Accept a submission and release payment.

```bash
stakework accept <task-id> <submission-id>
```

## stats

View worker statistics.

```bash
stakework stats <address>
```
