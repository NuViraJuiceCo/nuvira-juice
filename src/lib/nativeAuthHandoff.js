const HANDOFF_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' };
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const HANDOFF_TTL_MS = 10 * 60 * 1000;

export const NATIVE_AUTH_HANDOFF_STORAGE_KEY = 'nuvira_native_auth_handoff_v1';

export function clearNativeAuthHandoff(options = {}) {
  try {
    getStorage(options.storage).removeItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY);
  } catch {
    // Unavailable storage cannot retain a usable handoff in this runtime.
  }
}

function getCryptoApi(override) {
  const cryptoApi = override || globalThis.crypto;
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('native_auth_crypto_unavailable');
  }
  return cryptoApi;
}

function getStorage(override) {
  const storage = override || globalThis.localStorage;
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) {
    throw new Error('native_auth_storage_unavailable');
  }
  return storage;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('native_auth_handoff_invalid');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function encodeJson(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

function randomState(cryptoApi) {
  return bytesToBase64Url(cryptoApi.getRandomValues(new Uint8Array(24)));
}

async function importPublicKey(cryptoApi, encodedKey) {
  return cryptoApi.subtle.importKey(
    'jwk',
    decodeJson(encodedKey),
    HANDOFF_ALGORITHM,
    false,
    [],
  );
}

async function deriveEncryptionKey(cryptoApi, privateKey, publicKey, usage) {
  return cryptoApi.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: ENCRYPTION_ALGORITHM, length: 256 },
    false,
    [usage],
  );
}

export async function prepareNativeAuthHandoff(callbackUrl, returnTo, options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const storage = getStorage(options.storage);
  const now = options.now ?? Date.now();
  const state = randomState(cryptoApi);
  const keyPair = await cryptoApi.subtle.generateKey(
    HANDOFF_ALGORITHM,
    true,
    ['deriveKey'],
  );
  const [publicKey, privateKey] = await Promise.all([
    cryptoApi.subtle.exportKey('jwk', keyPair.publicKey),
    cryptoApi.subtle.exportKey('jwk', keyPair.privateKey),
  ]);

  if (options.isCurrent && !options.isCurrent()) throw new Error('native_auth_handoff_interrupted');

  storage.setItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY, JSON.stringify({
    state,
    privateKey,
    returnTo,
    createdAt: now,
  }));

  const url = new URL(callbackUrl);
  url.searchParams.set('native_handoff_state', state);
  url.searchParams.set('native_handoff_public_key', encodeJson(publicKey));
  return url.toString();
}

export async function encryptNativeAuthHandoff(callbackPageUrl, accessToken, options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const now = options.now ?? Date.now();
  const callbackUrl = new URL(callbackPageUrl);
  const state = callbackUrl.searchParams.get('native_handoff_state');
  const encodedAppPublicKey = callbackUrl.searchParams.get('native_handoff_public_key');
  if (!state || !encodedAppPublicKey || !accessToken) {
    throw new Error('native_auth_handoff_invalid');
  }

  const appPublicKey = await importPublicKey(cryptoApi, encodedAppPublicKey);
  const ephemeralKeyPair = await cryptoApi.subtle.generateKey(
    HANDOFF_ALGORITHM,
    true,
    ['deriveKey'],
  );
  const encryptionKey = await deriveEncryptionKey(
    cryptoApi,
    ephemeralKeyPair.privateKey,
    appPublicKey,
    'encrypt',
  );
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(state);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    accessToken,
    state,
    issuedAt: now,
  }));
  const encrypted = await cryptoApi.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv, additionalData },
    encryptionKey,
    plaintext,
  );
  const ephemeralPublicKey = await cryptoApi.subtle.exportKey('jwk', ephemeralKeyPair.publicKey);
  const schemeUrl = new URL(options.schemeUrl || 'nuvira://auth/callback');
  schemeUrl.searchParams.set('native_provider_callback', '1');
  schemeUrl.searchParams.set('native_handoff_state', state);
  schemeUrl.searchParams.set('native_handoff_iv', bytesToBase64Url(iv));
  schemeUrl.searchParams.set('native_handoff_public_key', encodeJson(ephemeralPublicKey));
  schemeUrl.searchParams.set('native_handoff_payload', bytesToBase64Url(new Uint8Array(encrypted)));
  return schemeUrl.toString();
}

export async function consumeNativeAuthHandoff(callbackUrl, options = {}) {
  const cryptoApi = getCryptoApi(options.cryptoApi);
  const storage = getStorage(options.storage);
  const now = options.now ?? Date.now();
  const url = new URL(callbackUrl);
  const state = url.searchParams.get('native_handoff_state');
  const iv = url.searchParams.get('native_handoff_iv');
  const encodedBrowserPublicKey = url.searchParams.get('native_handoff_public_key');
  const payload = url.searchParams.get('native_handoff_payload');
  const pendingRaw = storage.getItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY);

  if (!state || !iv || !encodedBrowserPublicKey || !payload || !pendingRaw) {
    throw new Error('native_auth_handoff_invalid');
  }

  let pending;
  try {
    pending = JSON.parse(pendingRaw);
  } catch {
    throw new Error('native_auth_handoff_invalid');
  }

  const pendingAge = now - Number(pending.createdAt);
  if (
    pending.state !== state
    || !pending.privateKey
    || pendingAge < 0
    || pendingAge > HANDOFF_TTL_MS
  ) {
    throw new Error('native_auth_handoff_invalid');
  }

  try {
    const privateKey = await cryptoApi.subtle.importKey(
      'jwk',
      pending.privateKey,
      HANDOFF_ALGORITHM,
      false,
      ['deriveKey'],
    );
    const browserPublicKey = await importPublicKey(cryptoApi, encodedBrowserPublicKey);
    const decryptionKey = await deriveEncryptionKey(
      cryptoApi,
      privateKey,
      browserPublicKey,
      'decrypt',
    );
    const decrypted = await cryptoApi.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: base64UrlToBytes(iv),
        additionalData: new TextEncoder().encode(state),
      },
      decryptionKey,
      base64UrlToBytes(payload),
    );
    const result = JSON.parse(new TextDecoder().decode(decrypted));
    const tokenAge = now - Number(result.issuedAt);
    if (
      result.state !== state
      || typeof result.accessToken !== 'string'
      || !result.accessToken
      || tokenAge < 0
      || tokenAge > HANDOFF_TTL_MS
    ) {
      throw new Error('native_auth_handoff_invalid');
    }

    if ((options.isCurrent && !options.isCurrent())
      || storage.getItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY) !== pendingRaw) {
      throw new Error('native_auth_handoff_invalid');
    }
    storage.removeItem(NATIVE_AUTH_HANDOFF_STORAGE_KEY);
    return {
      accessToken: result.accessToken,
      returnTo: pending.returnTo,
    };
  } catch {
    throw new Error('native_auth_handoff_invalid');
  }
}
