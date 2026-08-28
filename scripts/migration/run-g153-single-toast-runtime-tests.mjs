#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/App.jsx', 'utf8');
const register = fs.readFileSync('src/pages/Register.jsx', 'utf8');
const criticalRunner = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['the app mounts one global toast runtime', () => {
    assert.match(app, /import \{ Toaster as SonnerToaster \} from ["']@\/components\/ui\/sonner["']/);
    assert.match(app, /<SonnerToaster position="top-center" richColors \/>/);
    assert.doesNotMatch(app, /AppToaster|components\/ui\/toaster/);
  }],
  ['registration reuses the global Sonner runtime', () => {
    assert.match(register, /import \{ toast \} from ["']sonner["']/);
    assert.match(register, /toast\.success\("Code sent", \{/);
    assert.match(register, /description: "Check your email for the new code\."/);
    assert.doesNotMatch(register, /components\/ui\/use-toast/);
  }],
  ['registration resend behavior remains success-only', () => {
    const resendStart = register.indexOf('const handleResend = async () => {');
    const googleStart = register.indexOf('const handleGoogle = () => {');
    assert.ok(resendStart >= 0 && googleStart > resendStart);
    const resend = register.slice(resendStart, googleStart);
    assert.match(resend, /await base44\.auth\.resendOtp\(email\);/);
    assert.match(resend, /toast\.success/);
    assert.match(resend, /catch \(err\)/);
    assert.match(resend, /setError\(err\.message \|\| "Failed to resend code"\)/);
  }],
  ['G153 remains in the critical regression suite', () => {
    assert.match(criticalRunner, /run-g153-single-toast-runtime-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  try {
    check();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`G153 single toast runtime tests passed (${passed}/${checks.length}).`);
