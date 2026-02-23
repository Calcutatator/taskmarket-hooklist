import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Button } from './ui/button';

interface TaskFilterBarProps {
  filters: {
    status: string;
    mode: string;
    tags: string;
    minReward: string;
    maxReward: string;
    deadlineHours: string;
  };
  onFilterChange: (key: string, value: string) => void;
  onClear?: () => void;
}

const DEFAULT_FILTERS = {
  mode: 'ALL',
  status: 'ALL',
  minReward: '',
  maxReward: '',
  deadlineHours: '',
  tags: '',
};

export function TaskFilterBar({ filters, onFilterChange, onClear }: TaskFilterBarProps) {
  const isDirty =
    filters.mode !== DEFAULT_FILTERS.mode ||
    filters.status !== DEFAULT_FILTERS.status ||
    filters.minReward !== DEFAULT_FILTERS.minReward ||
    filters.maxReward !== DEFAULT_FILTERS.maxReward ||
    filters.deadlineHours !== DEFAULT_FILTERS.deadlineHours ||
    filters.tags !== DEFAULT_FILTERS.tags;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label htmlFor="mode">Mode</Label>
          <Select value={filters.mode} onValueChange={(value) => onFilterChange('mode', value)}>
            <SelectTrigger id="mode">
              <SelectValue placeholder="All Modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Modes</SelectItem>
              <SelectItem value="bounty">Bounty</SelectItem>
              <SelectItem value="claim">Claim</SelectItem>
              <SelectItem value="pitch">Pitch</SelectItem>
              <SelectItem value="benchmark">Benchmark</SelectItem>
              <SelectItem value="auction">Auction</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="status">Status</Label>
          <Select value={filters.status} onValueChange={(value) => onFilterChange('status', value)}>
            <SelectTrigger id="status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="claimed">Claimed</SelectItem>
              <SelectItem value="worker_selected">Worker Selected</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="disputed">Disputed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="minReward">Min Reward (USDC)</Label>
          <Input
            id="minReward"
            type="number"
            placeholder="0"
            value={filters.minReward}
            onChange={(e) => onFilterChange('minReward', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="tags">Tags</Label>
          <Input
            id="tags"
            placeholder="design, frontend"
            value={filters.tags}
            onChange={(e) => onFilterChange('tags', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="maxReward">Max Reward (USDC)</Label>
          <Input
            id="maxReward"
            type="number"
            placeholder="any"
            value={filters.maxReward}
            onChange={(e) => onFilterChange('maxReward', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="deadlineHours">Expires within (hours)</Label>
          <Input
            id="deadlineHours"
            type="number"
            placeholder="any"
            value={filters.deadlineHours}
            onChange={(e) => onFilterChange('deadlineHours', e.target.value)}
          />
        </div>
      </div>

      {isDirty && onClear && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
