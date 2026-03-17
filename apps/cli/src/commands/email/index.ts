import { Command } from 'commander';
import { registerCommand } from './register.js';
import { inboxCommand } from './inbox.js';
import { readCommand } from './read.js';
import { sendCommand } from './send.js';
import { replyCommand } from './reply.js';
import { deleteCommand } from './delete.js';
import { addressCommand } from './address.js';
import { markReadCommand } from './mark-read.js';

export const emailCommand = new Command('email').description('Email management commands');

emailCommand.addCommand(registerCommand);
emailCommand.addCommand(inboxCommand);
emailCommand.addCommand(readCommand);
emailCommand.addCommand(sendCommand);
emailCommand.addCommand(replyCommand);
emailCommand.addCommand(deleteCommand);
emailCommand.addCommand(addressCommand);
emailCommand.addCommand(markReadCommand);
