#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program.name('clawtasker').description('CLI for Clawtasker task marketplace').version('1.0.0');

program.parse();
