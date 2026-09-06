#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = path.join(repo, 'base44/functions/getCustomerAccountDashboardData');
const shared = path.join(repo, 'base44/shared');
const destination = process.argv[2];
assert.ok(destination && path.isAbsolute(destination), 'Provide an absolute, empty staging directory.');
assert.ok(!fs.existsSync(destination), 'Refusing to overwrite an existing staging directory.');
const output = path.join(destination, 'base44/functions/getCustomerAccountDashboardData');
const modules = new Map();
const nameFor = (file) => file === path.join(root, 'entry.ts') ? 'entry.ts'
  : `module__${path.relative(file.startsWith(`${shared}/`) ? path.dirname(shared) : root, file).split(path.sep).join('__')}`;

function visit(file) {
  if (modules.has(file)) return;
  assert.ok(file.startsWith(`${root}/`) || file.startsWith(`${shared}/`), `Unpackaged dependency: ${file}`);
  const original = fs.readFileSync(file, 'utf8');
  modules.set(file, { original, packaged: original });
  const parsed = ts.createSourceFile(file, original, ts.ScriptTarget.Latest);
  const edits = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
    const dependency = path.resolve(path.dirname(file), specifier.text);
    visit(dependency);
    edits.push({ start: specifier.getStart(parsed), end: specifier.end, text: JSON.stringify(`./${nameFor(dependency)}`) });
  }
  let packaged = original;
  for (const edit of edits.reverse()) packaged = packaged.slice(0, edit.start) + edit.text + packaged.slice(edit.end);
  modules.set(file, { original, packaged });
}
visit(path.join(root, 'entry.ts'));
assert.equal(new Set([...modules.keys()].map(nameFor)).size, modules.size, 'Flat module names must be unique.');
fs.mkdirSync(output, { recursive: true });
for (const [file, { packaged }] of modules) fs.writeFileSync(path.join(output, nameFor(file)), packaged);
fs.writeFileSync(path.join(output, 'function.jsonc'), JSON.stringify({ name: 'getCustomerAccountDashboardData', entry: 'entry.ts' }, null, 2));
fs.writeFileSync(path.join(destination, 'base44/config.jsonc'), JSON.stringify({ name: 'NuVira canonical customer gateway release' }, null, 2));
console.log(JSON.stringify({ destination, modules: modules.size, function: 'getCustomerAccountDashboardData', source: root, transformation: 'relative import specifiers only; no handler logic changed' }, null, 2));
