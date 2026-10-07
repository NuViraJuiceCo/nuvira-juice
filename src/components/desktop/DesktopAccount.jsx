import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Package, Gift, Settings, LogOut, ShieldCheck, RefreshCw } from 'lucide-react';
import DesktopMemberLayout from './DesktopMemberLayout';
import CreditWallet from '@/components/account/CreditWallet';
import MemberProgramCard from '@/components/account/MemberProgramCard';
import ProfileAvatar from '@/components/account/ProfileAvatar';
import { isAdminUser } from '@/lib/admin-access';

export default function DesktopAccount({ user, dashData, orders, isLoading, isError, onRetry, journey, journeys, isProgramLoading, isProgramError, onRetryPrograms, onLogout }) {
  const loaded = Boolean(dashData) && !isError;
  return <DesktopMemberLayout title={user?.first_name ? `Welcome back, ${user.first_name}.` : 'Your NuVira account.'} description="A little freshness, all in one place." action={<div className="nv-member-identity"><ProfileAvatar userProfile={dashData?.customer_profile || null} size="small" /><Link className="nv-member-text-link" to="/account/settings"><Settings size={16} />Account Settings</Link></div>}>
    <div className="nv-member-overview">
      <section className="nv-member-orders" aria-labelledby="member-orders-title">
        <div className="nv-member-section-heading"><div><p className="nv-member-kicker">Your Orders</p><h2 id="member-orders-title">Fresh things ahead.</h2></div><Package size={24} aria-hidden="true" /></div>
        {isLoading ? <p className="nv-member-status" role="status">Loading your orders...</p> : !loaded ? <div className="nv-member-status" role="status"><p>Your order summary is unavailable right now.</p><button onClick={onRetry} className="nv-member-text-link"><RefreshCw size={16} />Try Again</button></div> : <>
          <div className="nv-member-order-count"><strong>{orders.length}</strong><span>{orders.length === 1 ? 'order in your history' : 'orders in your history'}</span></div>
          <p>{orders.length ? 'Track your deliveries and revisit your favorite mixes.' : 'Your first fresh delivery starts with a mix you love.'}</p>
          <Link className="nv-brand-button" to={orders.length ? '/account/orders' : '/shop'}>{orders.length ? 'View Your Orders' : 'Find Your Mix'}<ArrowRight size={18} /></Link>
        </>}
      </section>
      <section className="nv-member-credits" aria-label="NuVira credits">
        {loaded ? <CreditWallet dashData={dashData} /> : <div className="nv-member-credit-pending"><p className="nv-member-kicker">NuVira Credits</p><h2>{isLoading ? 'Loading your balance...' : 'Balance unavailable'}</h2><p>Your verified credits will appear here.</p></div>}
      </section>
    </div>
    <div className="nv-member-lower-grid">
      <section className="nv-member-program" aria-label="Your program"><MemberProgramCard journey={journey} journeys={journeys} isLoading={isProgramLoading} isError={isProgramError} onRetry={onRetryPrograms} /></section>
      <section className="nv-member-benefits"><p className="nv-member-kicker">More From Every Order</p><h2>Make it a good habit.</h2><Link to="/rewards"><span><strong>Your Rewards</strong><small>Points, perks, and something to look forward to.</small></span><ArrowRight size={18} /></Link><Link to="/referral"><span><strong>Share the Freshness</strong><small>Give friends $5 off their first order.</small></span><Gift size={18} /></Link><Link to="/return-reward"><span><strong>Return + Reward</strong><small>See how eligible bag returns earn credits.</small></span><ArrowRight size={18} /></Link></section>
    </div>
    <footer className="nv-member-account-footer"><Link to="/merch">NuVira Goods<ArrowRight size={16} /></Link><Link to="/partner">Partner With Us<ArrowRight size={16} /></Link>{isAdminUser(user) && <Link to="/admin/operations"><ShieldCheck size={16} />Operations</Link>}<button onClick={onLogout}><LogOut size={16} />Sign Out</button></footer>
  </DesktopMemberLayout>;
}
