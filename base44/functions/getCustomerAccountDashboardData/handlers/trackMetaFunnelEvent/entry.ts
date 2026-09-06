import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { createMetaFunnelHandler } from './handler.js';

export default createMetaFunnelHandler({
  env: Deno.env,
  getUser: async (req) => {
    if (!req.headers.get('authorization')) return null;
    return createClientFromRequest(req).auth.me().catch(() => null);
  },
});
