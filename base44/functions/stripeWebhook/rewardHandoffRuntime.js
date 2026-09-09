import { runRewardHandoff } from './rewardHandoff.js';
import { isVerifiedNoPaymentOrder } from './rewardSettlement.js';
import { createRewardNativeHandoffAdapter } from './rewardNativeHandoff.js';
import { createRewardShopifyHandoffAdapter } from './rewardShopifyHandoff.js';
import { createRewardCustomerHandoffAdapters } from './rewardCustomerHandoff.js';
import { createRewardOperationsHandoffAdapters } from './rewardOperationsHandoff.js';
import { createRewardSmsHandoffAdapter } from './rewardSmsHandoff.js';

export const REWARD_HANDOFF_RUNTIME_REVISION = '2026-09-08.reward-handoff-runtime-v1';

// Called only after signed-event verification and independent provider/ledger
// settlement. Construction itself performs no provider or entity operations.
// The ordinary paid-order and advertising Purchase branches stay separate.
export async function runVerifiedRewardHandoff({ base44, result, env, fetchImpl, now, attemptId }) {
  if (!isVerifiedNoPaymentOrder(result?.order) || typeof env?.get !== 'function') {
    throw new Error('reward_handoff_settlement_required');
  }
  const resendApiKey = env.get('RESEND_API_KEY');
  const adapters = {
    ...createRewardNativeHandoffAdapter({ base44, internalSecret: env.get('CUSTOMER_APP_SYNC_SECRET') }),
    ...createRewardShopifyHandoffAdapter({ base44, fetchShopify: fetchImpl,
      shopifyStoreUrl: env.get('SHOPIFY_STORE_URL'), shopifyApiToken: env.get('SHOPIFY_API_TOKEN') }),
    ...createRewardCustomerHandoffAdapters({ base44, fetchEmail: fetchImpl, resendApiKey }),
    ...createRewardOperationsHandoffAdapters({ base44, fetchEmail: fetchImpl, resendApiKey }),
    sms: createRewardSmsHandoffAdapter({ base44, fetchStatus: fetchImpl,
      apiKey: env.get('SENDBLUE_API_KEY'), apiSecret: env.get('SENDBLUE_API_SECRET'),
      senderPhone: env.get('SENDBLUE_PHONE_NUMBER') }),
  };
  return runRewardHandoff({ entities: base44.asServiceRole.entities, orderId: result.order.id,
    adapters, ...(now ? { now } : {}), ...(attemptId ? { attemptId } : {}) });
}
