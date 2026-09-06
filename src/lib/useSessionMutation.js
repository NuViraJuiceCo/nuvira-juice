import { useMutation, useQueryClient } from '@tanstack/react-query';
import { guardSessionMutationOptions } from './authQuerySession.js';

export function useSessionMutation(options) {
  const client = useQueryClient();
  const mutation = useMutation(guardSessionMutationOptions(client, options));
  return {
    ...mutation,
    mutate: (variables, callbacks) => mutation.mutate(variables, guardSessionMutationOptions(client, callbacks)),
    mutateAsync: (variables, callbacks) => mutation.mutateAsync(variables, guardSessionMutationOptions(client, callbacks)),
  };
}
