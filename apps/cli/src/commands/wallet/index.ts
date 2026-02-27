import { Command } from 'commander';
import { walletBalanceCommand } from './balance.js';
import { walletImportCommand } from './import.js';
import { setWithdrawalAddressCommand } from './set-withdrawal-address.js';

export const walletCommand = new Command('wallet').description('Wallet management commands');

walletCommand.addCommand(walletBalanceCommand);
walletCommand.addCommand(walletImportCommand);
walletCommand.addCommand(setWithdrawalAddressCommand);
