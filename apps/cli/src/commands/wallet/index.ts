import { Command } from 'commander';
import { walletImportCommand } from './import.js';
import { setWithdrawalAddressCommand } from './set-withdrawal-address.js';

export const walletCommand = new Command('wallet').description('Wallet management commands');

walletCommand.addCommand(walletImportCommand);
walletCommand.addCommand(setWithdrawalAddressCommand);
