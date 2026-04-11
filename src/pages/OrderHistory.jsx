import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { ArrowLeft, ChevronRight, Package, RotateCcw } from 'lucide-react';
import { useCart } from '@/lib/cartContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

const statusLabels = {
  order_received: 'Received',
  scheduled_for_juicing: 'Scheduled',
  in_production: 'In Production',
  bottled_packed: 'Packed',
  out_for_delivery: 'On the Way',
  arriving_soon: 'Arriving',
  delivered: 'Delivered',
  ready_for_pickup: 'Ready',
  picked_up: 'Picked Up',
};

export default function OrderHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['my-orders-all'],
    queryFn: () => base44.entities.Order.filter(
      { customer_email: user?.email },
      '-created_date',
      50
    ),
    enabled: !!user?.email,
  });

  const activeOrders = orders.filter(o => !['delivered', 'picked_up'].includes(o.status));
  const completedOrders = orders.filter(o => ['delivered', 'picked_up'].includes(o.status));

  return (
    <div className="pb-4">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Orders</h1>
      </div>

      {isLoading ? (
        <div className="px-4 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-secondary/50 rounded-xl animate-pulse" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Package className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No orders yet</p>
          <Link to="/shop" className="text-sm text-primary font-medium mt-2">Start Shopping</Link>
        </div>
      ) : (
        <div className="px-4">
          {activeOrders.length > 0 && (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Active</h2>
              <div className="space-y-2 mb-5">
                {activeOrders.map((order, i) => (
                  <OrderCard key={order.id} order={order} index={i} />
                ))}
              </div>
            </>
          )}

          {completedOrders.length > 0 && (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Completed</h2>
              <div className="space-y-2">
                {completedOrders.map((order, i) => (
                  <OrderCard key={order.id} order={order} index={i} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, index }) {
  const isActive = !['delivered', 'picked_up'].includes(order.status);
  const { addItem } = useCart();
  const navigate = useNavigate();

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
      <Link to={isActive ? `/order-tracker/${order.id}` : `/order-tracker/${order.id}`}>
        <div className="bg-card rounded-xl border border-border/50 p-3.5 active:bg-secondary/50 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-sm font-medium">#{order.order_number}</p>
              <p className="text-[10px] text-muted-foreground">
                {order.created_date ? format(new Date(order.created_date), 'MMM d, yyyy') : ''}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className={`text-[10px] px-2 py-0.5 ${
                isActive ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
              }`}>
                {statusLabels[order.status] || order.status}
              </Badge>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          </div>
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
                  className="flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform"
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