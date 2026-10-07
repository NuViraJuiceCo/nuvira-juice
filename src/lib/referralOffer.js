// Customer-approved offer. Rewards remain manually verified; no points are promised.
export const REFERRAL_OFFER = Object.freeze({
  friendDiscount: 5,
  summary: 'Give $5 off their first order. Earn rewards at referral milestones.',
  terms: 'Referrals count after a completed purchase. Our team verifies referrals and applies rewards manually, then contacts you when you reach a milestone. Order minimums still apply.',
  milestones: Object.freeze([
    Object.freeze({ count: 5, title: 'A Bottle on Us', detail: 'Choose AURA, OASIS, or RE-NU.' }),
    Object.freeze({ count: 10, title: 'The NuVira Trio', detail: 'All three signature juices, together.' }),
    Object.freeze({ count: 20, title: 'A Month of VIP Wellness', detail: 'Your next referral milestone.' }),
  ]),
});
