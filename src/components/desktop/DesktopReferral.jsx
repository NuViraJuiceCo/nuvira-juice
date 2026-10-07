import React from 'react';
import { Copy, Check, Share2, Mail, ArrowRight } from 'lucide-react';
import DesktopMemberLayout from './DesktopMemberLayout';
import { REFERRAL_OFFER } from '@/lib/referralOffer';

export default function DesktopReferral({ code, copied, email, setEmail, sending, onCopy, onShare, onInvite }) {
  return <DesktopMemberLayout title="Share the Freshness" description="Good things are even better when you pass them on.">
    <section className="nv-referral-offer" aria-labelledby="referral-offer-title">
      <img src="/images/authentic-products/trio/trio-outdoor-bag.jpg" alt="AURA, OASIS, and RE-NU juices together with a NuVira tote" width="1200" height="900" />
      <div><p className="nv-member-kicker">A Fresh Introduction</p><h2 id="referral-offer-title">Their first sip.<br />Your good taste.</h2><p>Give a friend <strong>${REFERRAL_OFFER.friendDiscount} off their first order.</strong> Share your favorite mix and earn rewards as your referrals grow.</p></div>
    </section>
    <div className="nv-referral-tools">
      <section aria-labelledby="referral-share-title"><p className="nv-member-kicker">01 / Pass It On</p><h2 id="referral-share-title">A little something to share.</h2><label id="referral-code-label">Referral Code</label><div className="nv-referral-code"><output aria-labelledby="referral-code-label">{code}</output><button type="button" aria-label={copied ? 'Code copied' : 'Copy referral code'} title={copied ? 'Code copied' : 'Copy referral code'} onClick={onCopy}>{copied ? <Check size={20} /> : <Copy size={20} />}</button></div><button className="nv-brand-button nv-brand-button-primary" onClick={onShare}><Share2 size={18} />Share With Friends</button>
        <form className="nv-referral-email" onSubmit={event => { event.preventDefault(); onInvite(); }}><label htmlFor="referral-email">Or Invite by Email</label><div><input id="referral-email" type="email" required placeholder="friend@email.com" value={email} onChange={event => setEmail(event.target.value)} /><button disabled={sending || !email} type="submit" aria-label="Prepare email invitation" title="Prepare email invitation"><Mail size={20} /></button></div><p>Opens an invitation in your email app for you to send.</p></form>
      </section>
      <section className="nv-referral-milestones" aria-labelledby="referral-rewards-title"><p className="nv-member-kicker">02 / Enjoy the Rewards</p><h2 id="referral-rewards-title">More friends. More fresh.</h2><ol>{REFERRAL_OFFER.milestones.map(({ count, title, detail }) => <li key={count}><span><strong>{count}</strong>referrals</span><div><h3>{title}</h3><p>{detail}</p></div><ArrowRight size={18} aria-hidden="true" /></li>)}</ol><p className="nv-referral-terms">{REFERRAL_OFFER.terms}</p></section>
    </div>
  </DesktopMemberLayout>;
}
