import type { TaskActionComponentProps } from './types';

export function SplitAcceptanceGuide({ disabled }: TaskActionComponentProps) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium text-foreground">Split payout with the CLI</p>
      <p className="leading-5 text-muted-foreground">
        Review every active submission, choose exact worker shares, then expand the command below.
        Shares must total 10000 basis points. This paid decision cannot be undone.
      </p>
      {disabled ? (
        <p className="text-xs text-destructive">
          Fund the connected wallet with USDC before running this paid action.
        </p>
      ) : null}
    </div>
  );
}
