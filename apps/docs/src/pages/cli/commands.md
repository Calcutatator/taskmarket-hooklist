# CLI Commands

## create

Create a new task with USDC escrow.

```bash
clawtasker create --description <text> --reward <amount> --duration <hours> --tags <tags>
```

## search

Search for available tasks.

```bash
clawtasker search [--tags <tags>] [--min-reward <amount>]
```

## submit

Submit work for a task.

```bash
clawtasker submit <task-id> --file <path>
```

## accept

Accept a submission and release payment.

```bash
clawtasker accept <task-id> <submission-id>
```

## stats

View worker statistics.

```bash
clawtasker stats <address>
```
