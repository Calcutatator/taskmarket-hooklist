import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TerminalCard } from '@/components/landing/terminal';
import { isDirtyTaskFilter, type TaskListFilters } from './taskBrowseUtils';

interface TaskBrowseFiltersProps {
  filters: TaskListFilters;
  onFilterChange: (key: keyof TaskListFilters, value: string) => void;
  onClear: () => void;
}

const MODES = [
  ['ALL', 'all modes'],
  ['bounty', 'bounty'],
  ['claim', 'claim'],
  ['pitch', 'pitch'],
  ['benchmark', 'benchmark'],
  ['auction', 'auction'],
];

const STATUSES = [
  ['ALL', 'all status'],
  ['open', 'open'],
  ['claimed', 'claimed'],
  ['worker_selected', 'worker selected'],
  ['pending_approval', 'pending approval'],
  ['completed', 'completed'],
  ['expired', 'expired'],
  ['disputed', 'disputed'],
];

export function TaskBrowseFilters({ filters, onFilterChange, onClear }: TaskBrowseFiltersProps) {
  const dirty = isDirtyTaskFilter(filters);

  return (
    <TerminalCard className="h-fit p-5 lg:sticky lg:top-16">
      <div className="tm-faint font-mono text-[10px] uppercase tracking-[0.22em]">Filters</div>

      <div className="mt-5 space-y-5">
        <div>
          <p className="tm-faint mb-3 font-mono text-[10px] uppercase tracking-[0.18em]">Reward</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="minReward" className="tm-muted font-mono text-[11px]">
                Min reward
              </Label>
              <Input
                id="minReward"
                type="number"
                value={filters.minReward}
                onChange={(event) => onFilterChange('minReward', event.target.value)}
                placeholder="2.00"
                className="tm-field"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxReward" className="tm-muted font-mono text-[11px]">
                Max reward
              </Label>
              <Input
                id="maxReward"
                type="number"
                value={filters.maxReward}
                onChange={(event) => onFilterChange('maxReward', event.target.value)}
                placeholder="500"
                className="tm-field"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="tags"
            className="tm-faint font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            Tags
          </Label>
          <Input
            id="tags"
            value={filters.tags}
            onChange={(event) => onFilterChange('tags', event.target.value)}
            placeholder="scrape, react"
            className="tm-field"
          />
        </div>

        <div>
          <p className="tm-faint mb-3 font-mono text-[10px] uppercase tracking-[0.18em]">Mode</p>
          <Select value={filters.mode} onValueChange={(value) => onFilterChange('mode', value)}>
            <SelectTrigger id="mode" className="tm-field">
              <SelectValue placeholder="all modes" />
            </SelectTrigger>
            <SelectContent>
              {MODES.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <p className="tm-faint mb-3 font-mono text-[10px] uppercase tracking-[0.18em]">Status</p>
          <Select value={filters.status} onValueChange={(value) => onFilterChange('status', value)}>
            <SelectTrigger id="status" className="tm-field">
              <SelectValue placeholder="all status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="deadlineHours"
            className="tm-faint font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            Deadline
          </Label>
          <Input
            id="deadlineHours"
            type="number"
            value={filters.deadlineHours}
            onChange={(event) => onFilterChange('deadlineHours', event.target.value)}
            placeholder="hours"
            className="tm-field"
          />
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onClear}
        disabled={!dirty}
        className="tm-btn-outline mt-6 w-full rounded-none font-mono text-xs uppercase tracking-[0.08em]"
      >
        Reset filters
      </Button>
    </TerminalCard>
  );
}
