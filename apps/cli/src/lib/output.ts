export function isHumanMode(optsHuman?: boolean): boolean {
  if (optsHuman) return true;
  if (process.env['TASKMARKET_FORMAT'] === 'human') return true;
  return false;
}

export function printResult(data: unknown, human: boolean): void {
  if (!human) {
    console.log(JSON.stringify({ ok: true, data }, null, 2));
  }
  // human path: caller handles its own console.log as before
}

export function printError(message: string, human: boolean): never {
  if (!human) {
    console.error(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(message);
  }
  process.exit(1);
}
