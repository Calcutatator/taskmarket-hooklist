import { Command } from 'commander';
import { walletImportCommand } from './import.js';

export const walletCommand = new Command('wallet').description('Wallet management commands');

walletCommand.addCommand(walletImportCommand);
