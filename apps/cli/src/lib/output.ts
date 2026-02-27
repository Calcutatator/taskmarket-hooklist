export function printResult(data: unknown): void {
  console.log(JSON.stringify({ ok: true, data }));
}

export function printError(message: string): never {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(1);
}
