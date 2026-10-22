#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installedUpdate } from '../src/update/updater.mjs';

// After `pob update apply` the newer copy in the data folder answers instead (see launcher.mjs).
const update = installedUpdate();
const cli = update ? pathToFileURL(path.join(update.dir, 'src', 'cli', 'main.mjs')).href : '../src/cli/main.mjs';
const { main } = await import(cli);
process.exitCode = await main(process.argv.slice(2));
