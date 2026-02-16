import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';

interface TaskFilterBarProps {
  filters: {
    status: string;
    mode: string;
    tags: string;
    minReward: string;
  };
  onFilterChange: (key: string, value: string) => void;
}

export function TaskFilterBar({ filters, onFilterChange }: TaskFilterBarProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div>
        <Label htmlFor="mode">Mode</Label>
        <Select value={filters.mode} onValueChange={(value) => onFilterChange('mode', value)}>
          <SelectTrigger id="mode">
            <SelectValue placeholder="All Modes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Modes</SelectItem>
            <SelectItem value="contest">Contest</SelectItem>
            <SelectItem value="instant">Instant</SelectItem>
            <SelectItem value="proposal">Proposal</SelectItem>
            <SelectItem value="race">Race</SelectItem>
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
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
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
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          placeholder="design,frontend"
          value={filters.tags}
          onChange={(e) => onFilterChange('tags', e.target.value)}
        />
      </div>
    </div>
  );
}
