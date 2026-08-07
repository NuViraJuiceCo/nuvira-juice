#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  consumeNativeAuthHandoff,
  encryptNativeAuthHandoff,
  NATIVE_AUTH_HANDOFF_STORAGE_KEY,
  prepareNativeAuthHandoff,
} from '../../src/lib/nativeAuthHandoff.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const callbackBase = 'https://nuvirajuice.com/native-login?return_to=%2Faccount&native_provider_callback=1&native_browser_callback=1';
const syntheticToken = 'synthetic.header.payload.signature';
const startTime = 1_786_129_200_000;
const originalFetch = globalThis.fetch;
let unexpectedNetworkRequests = 0;
globalThis.fetch = async () => {
  unexpectedNetworkRequests += 1;
  throw new Error('unexpected_network_request');
};

async function createFlow(options = {}) {
  const storage = options.storage || new MemoryStorage();
  const preparedCallback = await prepareNativeAuthHandoff(
    callbackBase,
    '/account',
    { storage, now: options.prepareTime ?? startTime },
  );
  const encryptedCallback = await encryptNativeAuthHandoff(
    preparedCallback,
    options.token || syntheticToken,
    { now: options.encryptTime ?? startTime + 1000 },
  );
  return { encryptedCallback, preparedCallback, storage };
}

try {
  const flow = await createFlow();
  const preparedUrl = new URL(flow.preparedCallback);
  const encryptedUrl = new URL(flow.encryptedCallback);

  assert.equal(preparedUrl.origin, 'https://nuvirajuice.com');
  assert.ok(preparedUrl.searchParams.get('native_handoff_state'));
  assert.ok(preparedUrl.searchParams.get('native_handoff_public_key'));
  assert.equal(preparedUrl.searchParams.has('access_token'), false);
  assert.equal(flow.preparedCallback.includes(syntheticToken), false);
  assert.equal(encryptedUrl.protocol, 'nuvira:');
  assert.equal(encryptedUrl.host, 'auth');
  assert.equal(encryptedUrl.pathname, '/callback');
  assert.ok(encryptedUrl.searchParams.get('native_handoff_payload'));
  assert.equal(encryptedUrl.searchParams.has('access_token'), false);
  assert.equal(flow.encryptedCallback.includes(syntheticToken), false);

  const pending = JSON.parse(flow.storage.getItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY));
  assert.ok(pending.privateKey?.d, 'pending handoff must retain the private ECDH component locally');
  assert.equal(flow.preparedCallback.includes(pending.privateKey.d), false);

  const consumed = await consumeNativeAuthHandoff(flow.encryptedCallback, {
    storage: flow.storage,
    now: startTime + 2000,
  });
  assert.deepEqual(consumed, { accessToken: syntheticToken, returnTo: '/account' });
  assert.equal(flow.storage.getItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY), null);

  await assert.rejects(
    consumeNativeAuthHandoff(flow.encryptedCallback, {
      storage: flow.storage,
      now: startTime + 2000,
    }),
    /native_auth_handoff_invalid/,
  );

  const tampered = await createFlow();
  const tamperedUrl = new URL(tampered.encryptedCallback);
  const payload = tamperedUrl.searchParams.get('native_handoff_payload');
  tamperedUrl.searchParams.set(
    'native_handoff_payload',
    `${payload.startsWith('A') ? 'B' : 'A'}${payload.slice(1)}`,
  );
  await assert.rejects(
    consumeNativeAuthHandoff(tamperedUrl.toString(), {
      storage: tampered.storage,
      now: startTime + 2000,
    }),
    /native_auth_handoff_invalid/,
  );

  const wrongState = await createFlow();
  const wrongStateUrl = new URL(wrongState.encryptedCallback);
  wrongStateUrl.searchParams.set('native_handoff_state', 'wrong_state');
  await assert.rejects(
    consumeNativeAuthHandoff(wrongStateUrl.toString(), {
      storage: wrongState.storage,
      now: startTime + 2000,
    }),
    /native_auth_handoff_invalid/,
  );

  const expired = await createFlow();
  await assert.rejects(
    consumeNativeAuthHandoff(expired.encryptedCallback, {
      storage: expired.storage,
      now: startTime + (11 * 60 * 1000),
    }),
    /native_auth_handoff_invalid/,
  );

  const unicodeFlow = await createFlow({ token: 'synthetic-token-✓-保密' });
  const unicodeResult = await consumeNativeAuthHandoff(unicodeFlow.encryptedCallback, {
    storage: unicodeFlow.storage,
    now: startTime + 2000,
  });
  assert.equal(unicodeResult.accessToken, 'synthetic-token-✓-保密');

  const malformedStorage = new MemoryStorage();
  malformedStorage.setItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY, '{not-json');
  await assert.rejects(
    consumeNativeAuthHandoff('nuvira://auth/callback?native_handoff_state=x', {
      storage: malformedStorage,
      now: startTime,
    }),
    /native_auth_handoff_invalid/,
  );

  assert.equal(unexpectedNetworkRequests, 0);
  console.log(JSON.stringify({
    ok: true,
    suite: 'native-auth-encrypted-handoff',
    cases: 12,
    raw_token_in_callback: false,
    replay_rejected: true,
    tamper_rejected: true,
    expiry_enforced: true,
    external_calls_performed: false,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
