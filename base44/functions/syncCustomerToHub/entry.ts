/**
 * Backward-compatible no-op for installed clients and internal callers that
 * predate Customer App operational authority. It intentionally performs no
 * entity write, provider call, customer notification, or Hub request.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  return Response.json({
    success: true,
    skipped: true,
    retired: true,
    source: 'customer_app_native_authoritative',
    external_calls_performed: false,
  });
});
