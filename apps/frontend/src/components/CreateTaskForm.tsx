import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { parseUnits } from 'viem';
import { TaskCreateSchema, type TaskCreate } from '@taskmarket/shared';
import { API_URL } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './ui/form';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const TASK_MODES = [
  { value: 'bounty', label: 'Bounty', description: 'Multiple workers submit; you pick the best' },
  { value: 'claim', label: 'Claim', description: 'First worker claims exclusive rights' },
  {
    value: 'pitch',
    label: 'Pitch',
    description: 'Workers propose; you select one to execute',
  },
  { value: 'benchmark', label: 'Benchmark', description: 'First to hit metric target wins' },
  {
    value: 'auction',
    label: 'Auction',
    description: 'Workers bid down from your max price',
  },
] as const;

type Step = 'form' | 'payment' | 'signing' | 'submitting';

export function CreateTaskForm() {
  const { address } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const { signTypedDataAsync } = useSignTypedData();

  const form = useForm<TaskCreate>({
    resolver: zodResolver(TaskCreateSchema),
    defaultValues: {
      mode: 'bounty',
      tags: [],
      stakeRequired: false,
      stakeBps: 1000,
    },
  });

  const mode = form.watch('mode');
  const stakeRequired = form.watch('stakeRequired');

  const onSubmit = async (data: TaskCreate) => {
    if (!address) return;
    setError(null);

    try {
      // Convert human-readable USDC (e.g. "1.00") to base units (e.g. "1000000")
      const rewardBaseUnits = parseUnits(data.reward, 6).toString();
      const body: Record<string, unknown> = { ...data, reward: rewardBaseUnits };

      // Convert maxPrice to base units if provided
      if (data.maxPrice) {
        body.maxPrice = parseUnits(data.maxPrice, 6).toString();
      }

      // Step 1: Probe the endpoint to get 402 payment requirements
      setStep('payment');
      const probeRes = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (probeRes.status !== 402) {
        throw new Error(`Expected 402, got ${probeRes.status}`);
      }

      const payReq = await probeRes.json();
      const accepted = payReq.accepts?.[0];
      if (!accepted) throw new Error('No payment terms in 402 response');

      // Step 2: Sign the EIP-712 TransferWithAuthorization message
      setStep('signing');
      const eip712 = accepted.extra?.eip712;
      const requiredChainId = Number(eip712.domain.chainId);

      // Switch to the required chain. Try wagmi first; if wagmi's internal
      // state desynced (user switched chains in MetaMask outside of wagmi),
      // fall back to the raw EIP-3326 provider call so MetaMask still prompts.
      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).ethereum?.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${requiredChainId.toString(16)}` }],
        });
      }

      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as `0x${string}`;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300);

      const signature = await signTypedDataAsync({
        domain: {
          name: eip712.domain.name,
          version: eip712.domain.version,
          chainId: Number(eip712.domain.chainId),
          verifyingContract: eip712.domain.verifyingContract as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: eip712.types.TransferWithAuthorization,
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: address,
          to: accepted.payTo as `0x${string}`,
          value: BigInt(accepted.amount),
          validAfter: 0n,
          validBefore,
          nonce,
        },
      });

      // Step 3: Retry with payment-signature header
      setStep('submitting');
      const paymentPayload = {
        x402Version: 2,
        scheme: accepted.scheme,
        network: accepted.network,
        payload: {
          signature,
          authorization: {
            from: address,
            to: accepted.payTo,
            value: accepted.amount,
            validAfter: '0',
            validBefore: validBefore.toString(),
            nonce,
          },
        },
        accepted: {
          scheme: accepted.scheme,
          network: accepted.network,
          amount: accepted.amount,
          asset: accepted.asset,
          payTo: accepted.payTo,
          maxTimeoutSeconds: accepted.maxTimeoutSeconds,
        },
      };

      const paymentSignature = btoa(JSON.stringify(paymentPayload));

      const createRes = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': paymentSignature,
        },
        body: JSON.stringify(body),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${createRes.status}`);
      }

      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task creation failed');
      setStep('form');
    }
  };

  const isSubmitting = step !== 'form';

  const buttonLabel = () => {
    if (!address) return 'Connect Wallet to Create Task';
    if (step === 'payment') return 'Fetching payment terms...';
    if (step === 'signing') return 'Sign in MetaMask...';
    if (step === 'submitting') return 'Creating task...';
    return 'Create Task';
  };

  const statusMessage = () => {
    if (step === 'payment') return 'Step 1/3: Getting payment requirements...';
    if (step === 'signing') return 'Step 2/3: Sign the USDC authorization in MetaMask (no gas fee)';
    if (step === 'submitting') return 'Step 3/3: Submitting task...';
    return null;
  };

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
                        <SelectValue placeholder="Select task mode">
                          {TASK_MODES.find((m) => m.value === field.value)?.label}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TASK_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value} textValue={mode.label}>
                          <p className="font-semibold">{mode.label}</p>
                          <p className="text-sm text-text-secondary">{mode.description}</p>
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
                    <FormLabel>
                      {mode === 'auction' ? 'Max Price (USDC)' : 'Reward (USDC)'}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.000001"
                        min="0"
                        placeholder="1.00"
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

            {mode === 'claim' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Claim Mode Settings</h3>
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

            {mode === 'pitch' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Pitch Mode Settings</h3>
                <FormField
                  control={form.control}
                  name="pitchDeadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pitch Deadline</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {mode === 'benchmark' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Benchmark Mode Settings</h3>
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

            {mode === 'auction' && (
              <div className="space-y-4 p-4 bg-background-secondary rounded">
                <h3 className="font-semibold">Auction Mode Settings</h3>
                <FormField
                  control={form.control}
                  name="bidDeadline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid Deadline (hours from now)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="24"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {error && <p className="text-sm text-state-error-primary">{error}</p>}

            <div className="space-y-2">
              <Button
                type="submit"
                disabled={isSubmitting || !address}
                className="w-full"
                size="lg"
              >
                {buttonLabel()}
              </Button>
              {statusMessage() && (
                <p className="text-sm text-text-secondary text-center">{statusMessage()}</p>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
