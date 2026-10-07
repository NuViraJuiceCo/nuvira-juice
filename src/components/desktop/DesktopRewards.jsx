import React from 'react';
import { Link } from 'react-router-dom';
import { Star, Gift, Cake, ArrowRight, Check } from 'lucide-react';
import DesktopMemberLayout from './DesktopMemberLayout';
import { REFERRAL_OFFER } from '@/lib/referralOffer';

export default function DesktopRewards({ totalPoints, lifetimePoints, redeemedPoints, tier, rewards, activeReward, busy, onApply, onRemove, birthdayActive, hasBirthday, birthdayMessage, activationConfirmed, activity = [], earningOptions, children }) {
  const progress = tier.next ? Math.max(0, Math.min(100, (totalPoints - tier.min) / (tier.next - tier.min) * 100)) : 100;
  return <DesktopMemberLayout title="Your Rewards" description="Fresh favorites. A little more to look forward to." action={<Link className="nv-brand-button nv-brand-button-primary" to="/shop">Shop Juices <ArrowRight size={18} /></Link>}>
    {activationConfirmed && <p className="nv-reward-notice" role="status"><Check size={18} />Your rewards are active. Eligible purchase points and orders are connected to this account.</p>}
    <section className="nv-reward-balance" aria-label="Points balance">
      <div><p><Star size={18} />{tier.name} Member</p><strong>{totalPoints.toLocaleString()}</strong><span>Available Points</span></div>
      <div className="nv-reward-progress"><p>{tier.next ? `${(tier.next - totalPoints).toLocaleString()} points to your next tier` : 'You have reached Elite status'}</p><progress value={progress} max="100" aria-label="Progress toward next membership tier" /><dl><div><dt>Lifetime Earned</dt><dd>{lifetimePoints.toLocaleString()}</dd></div><div><dt>Redeemed</dt><dd>{redeemedPoints.toLocaleString()}</dd></div></dl></div>
    </section>
    <section className="nv-reward-birthday"><Cake size={24} aria-hidden="true" /><div><h2>Birthday Reward</h2><p>{birthdayActive ? 'Your free 12oz juice is ready.' : birthdayMessage}</p></div>{birthdayActive ? <Link to="/cart">Review in Cart <ArrowRight size={16} /></Link> : !hasBirthday ? <Link to="/account/settings">Set Your Birthday <ArrowRight size={16} /></Link> : null}</section>
    <section className="nv-reward-section" aria-labelledby="redeem-heading"><h2 id="redeem-heading">Make Your Points Count</h2><div className="nv-reward-catalog">
      {rewards.map((reward, index) => {
        const unlocked = Boolean(reward.id) && totalPoints >= reward.points_required;
        const active = Boolean(activeReward && ((reward.id && activeReward.id === reward.id) || activeReward.title === reward.title));
        return <article className="nv-reward-option" key={reward.id || index} data-active={active}>
          <div className="nv-reward-option-top"><Gift size={24} aria-hidden="true" /><span>{Number(reward.points_required).toLocaleString()} Points</span></div>
          <h3>{reward.title}</h3><p>{reward.reward_type === 'vip_box' ? 'Choose 6 included 12oz bottles. No extra merchandise required; delivery charges still apply.' : reward.description}</p>
          <button type="button" disabled={busy || (!active && !unlocked)} onClick={active ? onRemove : event => onApply(reward, event?.currentTarget)}>{active ? 'Remove Selected Reward' : unlocked ? 'Select Reward' : reward.id ? `${Math.max(0, reward.points_required - totalPoints).toLocaleString()} More Points to Unlock` : 'Not Currently Available'}{active && <Check size={16} />}</button>
        </article>;
      })}
    </div></section>
    <div className="nv-reward-columns"><section className="nv-reward-section"><h2>Everyday Ways to Earn</h2><ul className="nv-reward-earn">{earningOptions.map(({ icon: Icon, label, pts }) => <li key={label}><Icon size={20} aria-hidden="true" /><span>{label}</span><strong>{pts}</strong></li>)}</ul><Link className="nv-reward-referral" to="/referral"><span><strong>Share the Freshness</strong><small>{REFERRAL_OFFER.summary}</small></span><ArrowRight size={20} /></Link></section>
      <section className="nv-reward-section"><h2>Recent Activity</h2>{activity.length ? <ul className="nv-reward-activity">{activity.slice(-6).reverse().map((entry, index) => <li key={index}><div><strong>{entry.description}</strong><small>{new Date(entry.timestamp).toLocaleDateString()}</small></div><span>{entry.type === 'redeemed' ? '-' : '+'}{entry.amount} pts</span></li>)}</ul> : <div className="nv-reward-empty"><Star size={24} /><h3>Your next order starts here.</h3><p>Place your first order to start earning points.</p><Link to="/shop">Explore the Juices <ArrowRight size={16} /></Link></div>}</section></div>
    {children}
  </DesktopMemberLayout>;
}
