// Implements: ADR-0041
import express, { type Express } from 'express';
import { dispatchInteraction } from './interactions/dispatch';
import type { CommandDispatcher, DiscordCommandOutcome } from './interactions/types';
import { safeCommandName, type RecordOperationalEvent } from './observability/operational-events';
import { parseInteraction, verifyInteractionRequest } from './security/verify-interaction';

export interface AppIdentity {
  enabledCommands?: string[];
  commitSha: string;
  deployEnvironment: string;
  discordPublicKey?: string;
  commandDispatcher?: CommandDispatcher;
  recordOperationalEvent?: RecordOperationalEvent;
}

export function createApp(identity: AppIdentity): Express {
  const app = express();

  app.disable('x-powered-by');
  app.get('/health', (_request, response) => {
    response.json({
      capabilities: { commands: identity.enabledCommands ?? [] },
      environment: identity.deployEnvironment,
      status: 'ok',
      version: identity.commitSha,
    });
  });

  app.post(
    '/interactions',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (request, response) => {
      const startedAt = Date.now();
      const signature = request.header('x-signature-ed25519') ?? '';
      const timestamp = request.header('x-signature-timestamp') ?? '';
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

      if (!identity.discordPublicKey) {
        response.status(503).json({ error: 'Discord interactions are not configured' });
        return;
      }

      if (
        !verifyInteractionRequest({
          body,
          publicKeyHex: identity.discordPublicKey,
          signatureHex: signature,
          timestamp,
        })
      ) {
        identity.recordOperationalEvent?.({
          durationMs: Date.now() - startedAt,
          event: 'discord_interaction',
          outcome: 'invalid_signature',
        });
        response.status(401).json({ error: 'Invalid interaction signature' });
        return;
      }

      try {
        const interaction = parseInteraction(body);
        let outcome: DiscordCommandOutcome = 'ok';
        const interactionResponse = await dispatchInteraction(
          interaction,
          identity.commandDispatcher,
          (commandOutcome) => {
            outcome = commandOutcome;
          }
        );
        identity.recordOperationalEvent?.({
          command: safeCommandName(interaction.data?.name),
          durationMs: Date.now() - startedAt,
          event: 'discord_interaction',
          outcome,
        });
        response.json(interactionResponse);
      } catch {
        identity.recordOperationalEvent?.({
          durationMs: Date.now() - startedAt,
          event: 'discord_interaction',
          outcome: 'rejected',
        });
        response.status(400).json({ error: 'Unsupported interaction' });
      }
    }
  );

  return app;
}
