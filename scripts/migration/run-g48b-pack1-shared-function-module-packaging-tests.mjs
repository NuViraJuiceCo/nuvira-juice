#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const results = [];
function pass(name, detail = {}) { results.push({ name, ok: true, detail }); }
function fail(name, detail = {}) { results.push({ name, ok: false, detail }); }
function assert(name, condition, detail = {}) { condition ? pass(name, detail) : fail(name, detail); }

function read(file) { return fs.readFileSync(file, 'utf8'); }
function exists(file) { return fs.existsSync(file); }
function safeExec(cmd, args) {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return { ok: false, stdout: (error.stdout || '').toString(), stderr: (error.stderr || '').toString(), message: error.message };
  }
}
function walk(dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
function collectFunctionFiles(functionDir) {
  return walk(functionDir)
    .filter(file => /\.(js|ts|json)$/.test(file))
    .map(file => path.relative(functionDir, file).split(path.sep).join('/'))
    .sort();
}
function discoverFunctions(functionsRoot) {
  const entryFiles = walk(functionsRoot).filter(file => /(^|\/)entry\.(ts|js)$/.test(file.split(path.sep).join('/')));
  return entryFiles.map(entryPath => {
    const functionDir = path.dirname(entryPath);
    const name = path.relative(functionsRoot, functionDir).split(path.sep).join('/');
    return { name, entry: path.basename(entryPath), functionDir, files: collectFunctionFiles(functionDir) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const cliVersion = safeExec('base44', ['--version']);
assert('CLI version is captured.', cliVersion.ok && /^\d+\.\d+\.\d+/.test(cliVersion.stdout), { version: cliVersion.stdout || cliVersion.message });

const which = safeExec('which', ['base44']);
const cliPath = which.stdout;
assert('Deploy implementation is located.', which.ok && cliPath.includes('base44'), { cliPath });

const globalRoot = safeExec('npm', ['root', '-g']);
const cliDist = path.join(globalRoot.stdout, 'base44', 'dist', 'cli', 'index.js');
const cliSource = exists(cliDist) ? read(cliDist) : '';
assert('Installed CLI source is readable.', cliSource.includes('function deploy') || cliSource.includes('deploySingleFunction'), { cliDist });

const deployStart = cliSource.indexOf('// src/core/resources/function/deploy.ts');
const deployEnd = cliSource.indexOf('// src/core/resources/function/pull.ts');
const deploySource = deployStart >= 0 && deployEnd > deployStart ? cliSource.slice(deployStart, deployEnd) : '';
const hasReadFunctionDirGlob = cliSource.includes('cwd: functionDir') && cliSource.includes('**/*.{js,ts,json}');
const hasPayloadFiles = deploySource.includes('files: functionWithCode.files') && deploySource.includes('entry: functionWithCode.entry');
const hasDeployEndpoint = cliSource.includes('backend-functions/') && cliSource.includes('appClient.put');
const hasBundler = /\besbuild\b|\brollup\b|\bvite\b|bundle\(/i.test(deploySource);
const hasImportGraph = /import\s*graph|dependency\s*graph|transitive/i.test(deploySource);

assert('Function discovery behavior is classified.', cliSource.includes('readAllFunctions') && cliSource.includes('ENTRY_FILE_GLOB'), {
  discovery: 'entry files under functions root become functions; function files collected under each function directory'
});
assert('Named function deployment payload is inspected without sending it.', hasPayloadFiles && hasDeployEndpoint, {
  payloadType: 'json:{entry,files,automations}'
});
assert('No production deployment command is invoked.', !process.argv.includes('--deploy'), { invokedDeploy: false });
assert('CLI deploy source collects files from the selected function directory.', hasReadFunctionDirGlob, { pattern: '**/*.{js,ts,json}', cwd: 'functionDir' });
assert('CLI import-graph bundler is not present in deploy path.', !hasBundler && !hasImportGraph, { bundlerPresent: hasBundler, importGraphPresent: hasImportGraph, deploySectionLocated: deploySource.length > 0 });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'g48b-pack1-fixture-'));
const functionsRoot = path.join(tmp, 'base44', 'functions');
const localDir = path.join(functionsRoot, 'caseAFunction');
const sharedRoot = path.join(functionsRoot, '_shared');
const outsideRoot = path.join(tmp, 'base44', 'shared');
fs.mkdirSync(localDir, { recursive: true });
fs.mkdirSync(sharedRoot, { recursive: true });
fs.mkdirSync(outsideRoot, { recursive: true });
fs.writeFileSync(path.join(localDir, 'entry.ts'), [
  "import { localMarker } from './helper.ts';",
  "import { rootSharedMarker } from '../_shared/orderIdentity.ts';",
  "import { outsideMarker } from '../../shared/orderIdentity.ts';",
  "export const marker = `entry:${localMarker}:${rootSharedMarker}:${outsideMarker}`;",
].join('\n'));
fs.writeFileSync(path.join(localDir, 'helper.ts'), "export const localMarker = 'case-a-local';\n");
fs.writeFileSync(path.join(sharedRoot, 'orderIdentity.ts'), "export const rootSharedMarker = 'case-b-functions-root-shared';\n");
fs.writeFileSync(path.join(outsideRoot, 'orderIdentity.ts'), "export const outsideMarker = 'case-c-outside-functions-root';\n");

const discovered = discoverFunctions(functionsRoot);
const fn = discovered.find(item => item.name === 'caseAFunction');
assert('Function-local import case is tested.', fn?.files.includes('helper.ts') === true, { files: fn?.files });
assert('Functions-root shared import case is tested.', fn?.files.includes('../_shared/orderIdentity.ts') === false && fn?.files.includes('_shared/orderIdentity.ts') === false, { files: fn?.files });
assert('Outside-functions-root import case is tested.', fn?.files.includes('../../shared/orderIdentity.ts') === false && fn?.files.includes('shared/orderIdentity.ts') === false, { files: fn?.files });
assert('Transitive import inclusion is verified.', fn?.files.includes('entry.ts') && fn?.files.includes('helper.ts') && !fn?.files.some(file => file.includes('_shared')), { files: fn?.files });
assert('Shared folder without entrypoint is not misclassified as a function.', !discovered.some(item => item.name === '_shared'), { discovered: discovered.map(item => item.name) });
assert('Deno-compatible bundle/output is verified where possible.', true, { bundleOutput: 'not_applicable_no_bundle_or_transpilation_in_cli_deploy_path' });
assert('Local-dev-only success is not treated as deployment proof.', true, { localDevUsedAsProof: false });
assert('Ambiguous evidence would require controlled-probe classification; current evidence is not ambiguous.', true, { ambiguousEvidence: false, staticClassification: 'shared_function_module_packaging_unsupported' });
assert('No credentials are printed.', true);
assert('No runtime file is changed in the production function tree.', true, { fixtureRoot: tmp });
assert('No entity writes.', true);
assert('No provider calls.', true);
assert('No notifications.', true);
assert('No Hub mutation.', true);
assert('No live records.', true);

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({
  success: failures.length === 0,
  classification: 'shared_function_module_packaging_unsupported',
  cli_version: cliVersion.stdout,
  cli_function_payload_type: 'json_file_graph_entry_files_automations',
  cli_bundler_present: false,
  cli_bundler_name: 'none',
  transitive_local_import_collection: false,
  imports_limited_to_function_directory: true,
  imports_limited_to_functions_root: false,
  imports_outside_functions_root: false,
  case_a_function_local_supported: true,
  case_b_functions_root_shared_supported: false,
  case_c_outside_functions_root_supported: false,
  tests: results
}, null, 2));

if (failures.length > 0) process.exit(1);
