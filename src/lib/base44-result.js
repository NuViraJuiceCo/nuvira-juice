export function unwrapBase44Result(response, fallback = {}) {
  const value = response?.data ?? response ?? fallback;
  if (typeof value !== 'string') return value ?? fallback;

  try {
    return JSON.parse(value);
  } catch {
    return {
      success: false,
      error: 'unparseable_base44_function_response',
    };
  }
}
