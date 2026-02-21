import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useAccount } from 'wagmi';
import { parseUnits } from 'viem';
import { TaskCreateSchema, type TaskCreate } from '@clawtasker/shared';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useApproveUSDC } from '@/hooks/useApproveUSDC';
import { useCreateTask } from '@/hooks/useTaskMarket';
import { trpc } from '@/contexts/TRPCProvider';

const TASK_MODES = [
  { value: 'contest', label: 'Contest', description: 'Multiple workers submit; you pick the best' },
  { value: 'instant', label: 'Instant', description: 'First worker claims exclusive rights' },
  {
    value: 'proposal',
    label: 'Proposal',
    description: 'Workers propose; you select one to execute',
  },
  { value: 'race', label: 'Race', description: 'First to hit metric target wins' },
] as const;

export function CreateTaskForm() {
  const { address } = useAccount();
  const navigate = useNavigate();
  const [step, setStep] = useState<'form' | 'approve' | 'create'>('form');

  const { approve } = useApproveUSDC();
  const { createTask } = useCreateTask();
  const createTaskMutation = trpc.tasks.create.useMutation();

  const form = useForm<TaskCreate>({
    resolver: zodResolver(TaskCreateSchema),
    defaultValues: {
      mode: 'contest',
      tags: [],
      stakeRequired: false,
      stakeBps: 1000,
    },
  });

  const mode = form.watch('mode');
  const stakeRequired = form.watch('stakeRequired');

  const onSubmit = async (data: TaskCreate) => {
    if (!address) return;

    try {
      const rewardBigInt = parseUnits(data.reward.toString(), 6);
      const durationSeconds = data.duration * 3600;

      // Step 1: Approve USDC
      setStep('approve');
      await approve(rewardBigInt);

      // Step 2: Create task on-chain
      setStep('create');
      const taskId = `0x${Date.now().toString(16).padStart(64, '0')}` as `0x${string}`;
      const modeNum = ['contest', 'instant', 'proposal', 'race'].indexOf(data.mode);
      const proposalDeadlineTimestamp =
        data.mode === 'proposal' && data.proposalDeadline
          ? Math.floor(new Date(data.proposalDeadline).getTime() / 1000)
          : 0;

      await createTask(
        taskId,
        rewardBigInt,
        BigInt(durationSeconds),
        modeNum,
        BigInt(proposalDeadlineTimestamp)
      );

      // Step 3: Save to backend
      await createTaskMutation.mutateAsync({
        ...data,
      });

      navigate({ to: '/' });
    } catch (error) {
      console.error('Task creation failed:', error);
      setStep('form');
    }
  };

  const isSubmitting = step !== 'form';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a New Task</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Mode</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select task mode" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TASK_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          <div>
                            <p className="font-semibold">{mode.label}</p>
                            <p className="text-sm text-text-secondary">{mode.description}</p>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the task requirements in detail..."
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reward"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reward (USDC)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="100.00"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="duration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (hours)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="48"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tags (comma-separated)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="design, frontend, urgent"
                      onChange={(e) =>
                        field.onChange(
                          e.target.value
                            .split(',')
                            .map((tag) => tag.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mode === 'instant' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Instant Mode Settings</h3>
                <FormField
                  control={form.control}
                  name="stakeRequired"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={(e) => field.onChange(e.target.checked)}
                        />
                      </FormControl>
                      <FormLabel className="!mt-0">Require worker stake</FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {stakeRequired && (
                  <FormField
                    control={form.control}
                    name="stakeBps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stake Percentage (basis points, 1000 = 10%)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="1000"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {mode === 'proposal' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Proposal Mode Settings</h3>
                <FormField
                  control={form.control}
                  name="proposalDeadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proposal Deadline</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {mode === 'race' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Race Mode Settings</h3>
                <FormField
                  control={form.control}
                  name="metricDescription"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Metric Description</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Website load time in milliseconds" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="metricTarget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Value</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., 500" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="space-y-2">
              <Button
                type="submit"
                disabled={isSubmitting || !address}
                className="w-full"
                size="lg"
              >
                {!address
                  ? 'Connect Wallet'
                  : step === 'approve'
                    ? 'Approving USDC...'
                    : step === 'create'
                      ? 'Creating Task...'
                      : 'Create Task'}
              </Button>
              {isSubmitting && (
                <p className="text-sm text-text-secondary text-center">
                  {step === 'approve' && 'Step 1/2: Approving USDC transfer...'}
                  {step === 'create' && 'Step 2/2: Creating task on-chain...'}
                </p>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
