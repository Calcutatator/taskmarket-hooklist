#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('stakework')
  .description('CLI for Stakework task marketplace')
  .version('1.0.0');

program.parse();
