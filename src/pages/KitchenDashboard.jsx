import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Clock, CheckCircle2, AlertCircle, Truck } from 'lucide-react';
import { motion } from 'framer-motion';

const statusColors = {
  new: 'bg-gray-100 text-gray-900',
  awaiting_production: 'bg-yellow-100 text-yellow-900',
  in_production: 'bg-blue-100 text-blue-900',
  bottled: 'bg-purple-100 text-purple-900',
  labeled: 'bg-purple-100 text-purple-900',
  qc_checked: 'bg-green-100 text-green-900',
  packed: 'bg-green-100 text-green-900',
  in_cold_storage: 'bg-blue-100 text-blue-900',
  assigned_for_delivery: 'bg-cyan-100 text-cyan-900',
  fulfilled: 'bg-emerald-100 text-emerald-900',
  canceled: 'bg-red-100 text-red-900',
  refunded: 'bg-red-100 text-red-900',
};

const statusLabels = {
  new: 'New Order',
  awaiting_production: 'Awaiting Production',
  in_production: 'In Production',
  bottled: 'Bottled',
  labeled: 'Labeled',
  qc_checked: 'QC Checked',
  packed: 'Packed',
  in_cold_storage: 'Cold Storage',
  assigned_for_delivery: 'Assigned for Delivery',
  fulfilled: 'Fulfilled',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

export default function KitchenDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['kitchen-orders'],
    queryFn: () => base44.entities.ShopifyOrder.filter({}, '-created_date', 50),
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = base44.entities.ShopifyOrder.subscribe((event) => {
      console.log(`Order ${event.id} ${event.type}d — refreshing`);
      refetch();
    });
    return unsubscribe;
  }, [refetch]);

  // Redirect non-admins
  if (user && user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-900 mb-2">Access Denied</p>
          <p className="text-slate-600 mb-4">This dashboard is for admins only.</p>
          <button onClick={() => navigate('/')} className="text-primary underline">← Back to home</button>
        </div>
      </div>
    );
  }

  const pendingOrders = orders.filter(o => !['fulfilled', 'canceled', 'refunded'].includes(o.production_status));
  const completedOrders = orders.filter(o => ['fulfilled', 'canceled', 'refunded'].includes(o.production_status));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900">🍊 Kitchen Dashboard</h1>
          <p className="text-slate-600 mt-1">Real-time order tracking from customer app & Shopify</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-600">Pending Orders</p>
            <p className="text-3xl font-bold text-slate-900 mt-1">{pendingOrders.length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-600">Completed Today</p>
            <p className="text-3xl font-bold text-emerald-600 mt-1">{completedOrders.filter(o => o.production_status === 'fulfilled').length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-600">In Production</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{orders.filter(o => o.production_status === 'in_production').length}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
            <p className="text-sm text-slate-600">Ready for Delivery</p>
            <p className="text-3xl font-bold text-cyan-600 mt-1">{orders.filter(o => o.production_status === 'assigned_for_delivery').length}</p>
          </div>
        </div>

        {/* Pending Orders */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Pending Orders</h2>
          {isLoading ? (
            <div className="text-center py-8 text-slate-600">Loading orders...</div>
          ) : pendingOrders.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border border-dashed border-slate-300 text-slate-600">
              No pending orders
            </div>
          ) : (
            <div className="space-y-3">
              {pendingOrders.map(order => (
                <motion.div
                  key={order.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-slate-900">{order.shopify_order_number}</p>
                      <p className="text-sm text-slate-600">{order.customer_email}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[order.production_status] || 'bg-gray-100'}`}>
                      {statusLabels[order.production_status] || order.production_status}
                    </span>
                  </div>

                  {/* Items */}
                  <div className="mb-3 bg-slate-50 rounded-lg p-2">
                    <p className="text-xs text-slate-600 font-medium mb-1">Items:</p>
                    {order.line_items?.map((item, idx) => (
                      <p key={idx} className="text-sm text-slate-700">
                        {item.quantity}x {item.title}
                      </p>
                    ))}
                  </div>

                  {/* Workflow Checklist */}
                  {order.workflow_checklist && (
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      {[
                        { key: 'produce_pulled', label: 'Produce' },
                        { key: 'juice_pressed', label: 'Pressed' },
                        { key: 'bottled', label: 'Bottled' },
                        { key: 'labeled', label: 'Labeled' },
                        { key: 'qc_checked', label: 'QC' },
                        { key: 'packed', label: 'Packed' },
                      ].map(step => (
                        <div
                          key={step.key}
                          className={`p-2 rounded text-center font-medium ${
                            order.workflow_checklist[step.key]
                              ? 'bg-green-100 text-green-900'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {order.workflow_checklist[step.key] ? '✓' : '◯'} {step.label}
                        </div>
                      ))}
                    </div>
                  )}

                  {order.internal_notes && (
                    <p className="text-xs text-slate-600 mt-2 italic">📝 {order.internal_notes}</p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Completed Orders */}
        <div>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Completed</h2>
          {completedOrders.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl border border-dashed border-slate-300 text-slate-600">
              No completed orders yet
            </div>
          ) : (
            <div className="space-y-2">
              {completedOrders.slice(0, 10).map(order => (
                <div key={order.id} className="bg-white rounded-lg p-3 border border-slate-200 opacity-75">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-700">{order.shopify_order_number}</p>
                      <p className="text-xs text-slate-600">{order.customer_email}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColors[order.production_status]}`}>
                      {statusLabels[order.production_status]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}