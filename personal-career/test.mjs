#!/usr/bin/env node
// Independent runner: keep the extension's only tests outside updater-owned trees.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const directory=join(dirname(fileURLToPath(import.meta.url)),'tests');
const suites=readdirSync(directory).filter(n=>n.endsWith('.spec.mjs')).sort().map(n=>join(directory,n));
if(!suites.length) throw new Error('No personal workflow test suites found');
const result=spawnSync(process.execPath,['--test',...suites],{stdio:'inherit',shell:false});
if(result.error) throw result.error;
process.exitCode=result.status??1;
