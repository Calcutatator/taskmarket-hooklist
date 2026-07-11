import type { Request } from 'express';
import { db } from '../db/client';
import {
  PaidTaskActionError,
  type PaidTaskAction,
  validatePaidTaskAction,
} from '../services/task-action-preflight';
import { X402PreflightError } from './x402';

export function taskActionPreflight(action: PaidTaskAction) {
  return async (req: Request, payer: string): Promise<void> => {
    try {
      await validatePaidTaskAction(db, action, req, payer);
    } catch (error) {
      if (error instanceof PaidTaskActionError) {
        throw new X402PreflightError(error.message, error.status);
      }
      throw error;
    }
  };
}
