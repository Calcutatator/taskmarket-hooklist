'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

export type RangeOption = {
  value: string;
  label: string;
  shortLabel?: string;
};

const DEFAULT_OPTIONS: RangeOption[] = [
  { value: '7d', label: 'Last 7 days', shortLabel: '7d' },
  { value: '30d', label: 'Last 30 days', shortLabel: '30d' },
  { value: '90d', label: 'Last 3 months', shortLabel: '90d' },
];

// The responsive range control extracted from chart-area-interactive.tsx: a
// segmented ToggleGroup on desktop and a Select on mobile, sharing one value.
// Drop this into a ChartCard `action` so every chart gets the same control.
export function RangeToggle({
  value,
  onValueChange,
  options = DEFAULT_OPTIONS,
  className,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options?: RangeOption[];
  className?: string;
  ariaLabel?: string;
}) {
  // ToggleGroup clears the value when the active item is toggled off; ignore the
  // empty string so a range is always selected.
  const handleToggle = (next: string) => {
    if (next) {
      onValueChange(next);
    }
  };

  const activeLabel = options.find((option) => option.value === value)?.label;

  return (
    <div className={className}>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={handleToggle}
        variant="outline"
        aria-label={ariaLabel}
        className={cn('hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex')}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
          size="sm"
          aria-label={ariaLabel ?? 'Select a range'}
        >
          <SelectValue placeholder={activeLabel} />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="rounded-lg">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
