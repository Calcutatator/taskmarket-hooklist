'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * Confirmation dialog wrapping a destructive action. The trigger button
 * stays visible; clicking it opens the dialog. The user must press the
 * confirmCta button to run `onConfirm`.
 */
export function ConfirmDialog({
  children,
  confirmCta = 'Confirm',
  description,
  disabled,
  loadingCta,
  onConfirm,
  title,
}: {
  children: React.ReactNode;
  confirmCta?: string;
  description: React.ReactNode;
  disabled?: boolean;
  loadingCta?: string;
  onConfirm: () => Promise<void>;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={() => setOpen(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={disabled || pending} onClick={handleConfirm} variant="destructive">
            {pending ? (loadingCta ?? `${confirmCta}...`) : confirmCta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
