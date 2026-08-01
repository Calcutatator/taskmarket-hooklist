const WORKER_ARGUMENT = /(^|\s)--worker(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/;

export function commandForTaskWorker(command: string, workerAddress: string): string {
  if (WORKER_ARGUMENT.test(command)) {
    return command.replace(WORKER_ARGUMENT, `$1--worker ${workerAddress}`);
  }

  return `${command.trimEnd()} --worker ${workerAddress}`;
}
