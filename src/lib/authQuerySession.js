import { createQueryClient } from './query-client.js';

const retiredClients = new WeakSet();

export const isCurrentAuthQueryClient = (client) => !retiredClients.has(client);

export function guardSessionMutationOptions(client, options = {}) {
  const guarded = { ...options };
  for (const key of ['onMutate', 'onSuccess', 'onError', 'onSettled']) {
    if (typeof options[key] === 'function') {
      guarded[key] = (...args) => {
        if (!isCurrentAuthQueryClient(client)) return undefined;
        return options[key](...args);
      };
    }
  }
  if (typeof options.mutationFn === 'function') {
    guarded.mutationFn = (...args) => {
      if (!isCurrentAuthQueryClient(client)) {
        return Promise.reject(new Error('auth_session_changed'));
      }
      return options.mutationFn(...args);
    };
  }
  return guarded;
}

function identityOf(user) {
  if (user?.id) return `id:${user.id}`;
  if (user?.email) return `email:${String(user.email).trim().toLowerCase()}`;
  return null;
}

export function createAuthSessionBoundary() {
  let request = 0;
  let session = { identity: null, epoch: 0, client: createQueryClient() };

  return {
    getSession: () => session,
    beginRequest: () => ++request,
    isCurrentRequest: (candidate) => candidate === request,
    invalidateRequests: () => { request++; },
    transition(user, { force = false } = {}) {
      const identity = identityOf(user);
      if (!force && identity === session.identity) return session;

      // A retired mutation can still finish. Its closure retains only the old
      // client, never the new principal's query or mutation cache.
      retiredClients.add(session.client);
      void session.client.cancelQueries();
      session.client.clear();
      session = { identity, epoch: session.epoch + 1, client: createQueryClient() };
      return session;
    },
  };
}
