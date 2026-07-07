import { Command } from 'commander';
import { walletBalanceCommand } from './balance.js';
import { walletImportCommand } from './import.js';
import { setWithdrawalAddressCommand } from './set-withdrawal-address.js';
import { publishKeyCommand } from './publish-key.js';
import { withdrawDreamsCommand } from './withdraw-dreams.js';

export const walletCommand = new Command('wallet').description('Wallet management commands');

walletCommand.addCommand(walletBalanceCommand);
walletCommand.addCommand(walletImportCommand);
walletCommand.addCommand(setWithdrawalAddressCommand);
walletCommand.addCommand(publishKeyCommand);
walletCommand.addCommand(withdrawDreamsCommand);
