#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const script = path.join(process.cwd(), 'scripts/ci/scan-tracked-secrets.mjs');
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { cwd: process.cwd(), stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
