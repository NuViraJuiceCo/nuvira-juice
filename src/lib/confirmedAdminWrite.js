import { unwrapBase44Result } from './base44-result';

export function requireConfirmedAdminWrite(response) {
  const result = unwrapBase44Result(response);
  if (result?.success !== true) throw new Error('The save could not be confirmed.');
  return result;
}
