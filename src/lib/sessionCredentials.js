import { isCurrentAuthOperation } from './authOperation.js';

export function createSessionCredentials(auth, operation) {
  const assertCurrent = () => {
    if (!isCurrentAuthOperation(operation)) {
      const error = new Error('Sign-in was superseded by another attempt.');
      error.code = 'auth_operation_superseded';
      throw error;
    }
  };
  const run = async (request) => {
    assertCurrent();
    try {
      const result = await request();
      assertCurrent();
      return result;
    } catch (error) {
      assertCurrent();
      throw error;
    }
  };
  const setToken = (token) => {
    assertCurrent();
    auth.setToken(token);
  };
  // The SDK calls this.setToken/this.logout inside its awaited password login.
  // Scope those effects to this attempt without patching the shared auth client.
  const receiver = {
    setToken,
    logout: () => {
      assertCurrent();
      // Invalid credentials stay on our form; they must not redirect to Base44
      // or clear a different, already authenticated session.
    },
  };
  return {
    assertCurrent,
    setToken,
    loginViaEmailPassword: (...args) => run(() => auth.loginViaEmailPassword.apply(receiver, args)),
    register: (payload) => run(() => auth.register(payload)),
    verifyOtp: (payload) => run(() => auth.verifyOtp(payload)),
    resendOtp: (email) => run(() => auth.resendOtp(email)),
    resetPasswordRequest: (email) => run(() => auth.resetPasswordRequest(email)),
  };
}
