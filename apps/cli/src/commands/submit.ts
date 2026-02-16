import { Command } from 'commander';
import { api } from '../lib/api';
import { getAddress, signMessage } from '../lib/wallet';
import { readFileSync } from 'fs';
import { Encryptor } from '@clawtasker/shared';

export const submitCommand = new Command('submit')
  .description('Submit work for a task')
  .argument('<taskId>', 'Task ID')
  .requiredOption('-f, --file <path>', 'Path to submission file')
  .option('--proof-url <url>', 'Proof URL (Race mode)')
  .option('--proof-type <type>', 'Proof type: url|screenshot|api_data|manual', 'url')
  .option('--metric-value <value>', 'Metric value achieved (Race mode)')
  .action(async (taskId, options) => {
    try {
      const address = await getAddress();

      const task = await api.tasks.get.query({ taskId });

      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }

      if (task.mode === 'race') {
        if (!options.proofUrl) {
          console.error('Race mode requires --proof-url');
          process.exit(1);
        }

        console.log('Submitting proof for Race task...');
        const signature = await signMessage(`Submit proof for task ${taskId}`);

        await api.proofs.submit.mutate({
          taskId,
          workerAddress: address,
          proofData: options.proofUrl,
          proofType: options.proofType,
          metricValue: options.metricValue,
          signature,
        });

        console.log('\n✓ Proof submitted successfully!');
        return;
      }

      console.log('Encrypting submission file...');
      const fileContent = readFileSync(options.file);
      const encryptor = new Encryptor();
      const encrypted = await encryptor.encryptForRequester(
        fileContent.toString('base64'),
        task.requesterPubkey
      );

      console.log('Submitting encrypted file...');
      const signature = await signMessage(`Submit work for task ${taskId}`);

      await api.submissions.submit.mutate({
        taskId,
        workerAddress: address,
        encryptedFileData: encrypted.ciphertext,
        encryptedKeyBundle: JSON.stringify(encrypted.keyBundle),
        signature,
      });

      console.log('\n✓ Submission uploaded successfully!');
      console.log('The requester will review your work.');
    } catch (error) {
      console.error('Error submitting work:', error);
      process.exit(1);
    }
  });
