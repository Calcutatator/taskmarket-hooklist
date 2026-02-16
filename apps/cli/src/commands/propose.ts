import { Command } from 'commander';
import { api } from '../lib/api';
import { getAddress, signMessage } from '../lib/wallet';

export const proposeCommand = new Command('propose')
  .description('Submit a proposal for a Proposal mode task')
  .argument('<taskId>', 'Task ID')
  .requiredOption('-t, --text <proposal>', 'Proposal text')
  .option('-d, --estimated-duration <hours>', 'Estimated completion time in hours')
  .action(async (taskId, options) => {
    try {
      const address = await getAddress();

      const task = await api.tasks.get.query({ taskId });

      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }

      if (task.mode !== 'proposal') {
        console.error('This task is not in Proposal mode');
        process.exit(1);
      }

      if (task.status !== 'open') {
        console.error('Task is not accepting proposals');
        process.exit(1);
      }

      if (task.proposalDeadline && new Date(task.proposalDeadline) < new Date()) {
        console.error('Proposal deadline has passed');
        process.exit(1);
      }

      console.log('Submitting proposal...');
      const signature = await signMessage(`Propose for task ${taskId}: ${options.text}`);

      await api.proposals.submit.mutate({
        taskId,
        workerAddress: address,
        proposalText: options.text,
        estimatedDuration: options.estimatedDuration
          ? parseInt(options.estimatedDuration) * 3600
          : undefined,
        signature,
      });

      console.log('\n✓ Proposal submitted successfully!');
      console.log('The requester will review your proposal.');
      console.log('If selected, you will be able to submit your work.');
    } catch (error) {
      console.error('Error submitting proposal:', error);
      process.exit(1);
    }
  });
