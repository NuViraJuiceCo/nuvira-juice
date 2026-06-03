import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PullToRefresh from '@/components/PullToRefresh';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ArrowLeft, ChevronRight, Package, RotateCcw, Leaf } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';
import { format } from 'date-fns';

// Parse date-only strings (YYYY-MM-DD) as LOCAL calendar dates to avoid UTC off-by-one.
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

const statusLabels = {
  order_received: 'Received',
  scheduled_for_juicing: 'Scheduled',
  scheduled_for_production: 'Scheduled',
  in_production: 'In Production',
  bottled_packed: 'Packed',
  out_for_delivery: 'On the Way',
  arriving_soon: 'Arriving',
  delivered: 'Delivered',
  ready_for_pickup: 'Ready',
  picked_up: 'Picked Up',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
};

export default function OrderHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: bagReturns = [] } = useQuery({
    queryKey: ['my-bag-returns'],
    queryFn: () => base44.entities.BagReturn.filter({ customer_email: user?.email }, '-created_date', 50),
    enabled: !!user?.email,
  });

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['my-orders-all', user?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('getCustomerAccountDashboardData', {});
      return res.data?.all_orders_raw || [];
    },
    enabled: !!user?.email,
  });

  // Fetch user profile ONCE at the list level — not per-card
  const { data: userProfile } = useQuery({
    queryKey: ['order-history-profile', user?.email],
    queryFn: async () => {
      if (!user?.email) return null;
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
      return profiles[0] || null;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60 * 1000,
  });

  // Show only real paid orders — same logic as backend allOrdersForHistory filter.
  // Keep: payment_captured=true OR payment_status/financial_status in [paid,refunded]
  // Hide: test orders, abandoned checkouts, failed uncaptured attempts
  const validOrders = orders.filter(o => {
    if (o.is_test_order) return false;
    if (o.is_abandoned_checkout) return false;
    const paymentWasCaptured = o.payment_captured === true
      || o.payment_status === 'paid'
      || o.payment_status === 'refunded'
      || o.financial_status === 'paid'
      || o.financial_status === 'refunded';
    return paymentWasCaptured;
  });
  const TERMINAL_STATUSES = ['delivered', 'picked_up', 'cancelled', 'refunded'];
  const activeOrders = validOrders.filter(o => !TERMINAL_STATUSES.includes(o.status));
  const completedOrders = validOrders.filter(o => TERMINAL_STATUSES.includes(o.status));

  return (
    <PullToRefresh onRefresh={refetch}>
    <div className="pb-4">
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Orders</h1>
      </div>

      {isLoading ? (
        <div className="px-4 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />)}
        </div>
      ) : validOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Package className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No valid orders yet</p>
          <Link to="/shop" onClick={() => sessionStorage.setItem('shopResetTab', '1')} className="text-sm text-primary font-medium mt-2">Start Shopping</Link>
        </div>
      ) : (
        <div className="px-4">
          {activeOrders.length > 0 && (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-2">Active</h2>
              <div className="space-y-2 mb-5">
                {activeOrders.map((order, i) => (
                  <OrderCard key={order.id} order={order} index={i} userProfile={userProfile} />
                ))}
              </div>
            </>
          )}

          {completedOrders.length > 0 && (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-2">Completed</h2>
              <div className="space-y-2">
                {completedOrders.map((order, i) => (
                  <OrderCard key={order.id} order={order} index={i} userProfile={userProfile} bagReturn={bagReturns.find(r => r.order_id === order.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}

const returnStatusColor = {
  requested: 'text-amber-600 bg-amber-50',
  verified: 'text-primary bg-primary/10',
  partially_verified: 'text-amber-600 bg-amber-50',
  not_found: 'text-muted-foreground bg-secondary',
  not_eligible: 'text-muted-foreground bg-secondary',
};

function OrderCard({ order, index, bagReturn, userProfile }) {
  const TERMINAL = ['delivered', 'picked_up', 'cancelled', 'refunded', 'failed'];
  const isActive = !TERMINAL.includes(order.status);
  const isCancelled = ['cancelled', 'refunded', 'failed'].includes(order.status);
  const { addItem } = useCart();
  const navigate = useNavigate();

  // Resolve customer name from passed-down profile

  const getDisplayName = () => {
    if (order.customer_name) return order.customer_name;
    if (userProfile?.first_name && userProfile?.last_name) {
      return `${userProfile.first_name} ${userProfile.last_name}`;
    }
    if (userProfile?.first_name) return userProfile.first_name;
    return order.customer_email || 'Order';
  };

  const handleReorder = (e) => {
    e.preventDefault();
    e.stopPropagation();
    order.items?.forEach(item => {
      addItem({ id: item.product_id, title: item.title, price: item.price, image_url: item.image_url }, item.quantity || 1);
    });
    toast.success('Items added to cart!');
    navigate('/cart');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Link to={order.order_number ? `/order-tracker/${order.order_number}?source=order_history` : `/order-tracker/${order.id}?source=order_history`}>
        <div className="bg-card rounded-xl border border-border/50 p-3.5 active:bg-secondary/50 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-sm font-medium">#{order.order_number} • {getDisplayName()}</p>
              <p className="text-[10px] text-muted-foreground">
                {order.created_date ? format(parseLocalDate(order.created_date), 'MMM d, yyyy') : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${
                isActive ? 'bg-primary/10 text-primary'
                : isCancelled ? 'bg-destructive/10 text-destructive'
                : 'bg-secondary text-muted-foreground'
              }`}>
                {statusLabels[order.status] || order.status}
              </Badge>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>
          {bagReturn && (
            <div className="flex items-center gap-1.5 mb-2">
              <Leaf className="w-3 h-3 text-primary" />
              <span className="text-[10px] text-muted-foreground">Return + Reward</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${returnStatusColor[bagReturn.verification_status] || ''}`}>
                {bagReturn.verification_status === 'requested' ? 'Pending' : bagReturn.verification_status?.replace('_', ' ')}
              </span>
              {bagReturn.credit_issued > 0 && (
                <span className="text-[10px] font-semibold text-primary">+${bagReturn.credit_issued.toFixed(2)}</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {order.items?.slice(0, 3).map((item, i) => (
                <div key={i} className="w-7 h-7 bg-secondary rounded-full border-2 border-card overflow-hidden">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs">🍊</div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground flex-1 truncate">
              {order.items?.map(i => i.title).join(', ')}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">${order.total?.toFixed(2)}</p>
              {!isActive && (
                <button
                  onClick={handleReorder}
                  className="flex items-center gap-1 bg-nuvira-gradient text-white text-[10px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  Reorder
                </button>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}