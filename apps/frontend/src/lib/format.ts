/** Format USDC atomic units (6 decimals) for display.
 * Shows at least 2 decimal places; trims trailing zeros beyond that.
 * e.g. 1000000 → "1.00", 1000 → "0.001", 1500000 → "1.50"
 */
export function formatUSDC(atomicUnits: string | number | null | undefined): string {
  const value = Number(atomicUnits ?? 0) / 1e6;
  return value.toFixed(3);
}
