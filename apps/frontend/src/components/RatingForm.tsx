import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAccount } from 'wagmi';
import { useRateTask } from '@/hooks/useTaskMarket';
import type { TaskResponse } from '@clawtasker/shared';

interface RatingFormProps {
  task: TaskResponse;
}

export function RatingForm({ task }: RatingFormProps) {
  const { address } = useAccount();
  const { rateTask, isPending } = useRateTask();
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);

  const isRequester = address?.toLowerCase() === task.requester.toLowerCase();
  const canRate = task.status === 'accepted' && task.rating === 0 && isRequester;

  if (!canRate) return null;

  const handleRate = () => {
    if (selectedRating > 0) {
      rateTask(task.id as `0x${string}`, selectedRating);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate This Task</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-text-secondary">How would you rate the quality of work delivered?</p>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className={`text-4xl transition-colors ${
                star <= (hoverRating || selectedRating) ? 'text-yellow-500' : 'text-border-primary'
              }`}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setSelectedRating(star)}
            >
              ★
            </button>
          ))}
          <span className="ml-2 text-text-secondary">
            {selectedRating > 0
              ? `${selectedRating} star${selectedRating > 1 ? 's' : ''}`
              : 'Select rating'}
          </span>
        </div>
        <Button
          onClick={handleRate}
          disabled={selectedRating === 0 || isPending}
          variant="success"
          className="w-full"
        >
          {isPending ? 'Submitting Rating...' : 'Submit Rating'}
        </Button>
      </CardContent>
    </Card>
  );
}
