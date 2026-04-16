import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

export default function CompositionEditor({ subscription, plan, products, onClose, onSaved }) {
  // Build initial quantities from existing custom_composition
  const source = subscription.custom_composition?.length
    ? subscription.custom_composition
    : [];

  const initialCounts = {};
  source.forEach(item => {
    initialCounts[item.product_id] = item.quantity;
  });

  const [counts, setCounts] = useState(initialCounts);
  const [saving, setSaving] = useState(false);

  const totalBottles = plan?.bottle_count || 6;
  const totalSelected = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = totalBottles - totalSelected;

  const adjust = (productId, delta) => {
    setCounts(prev => {
      const next = { ...prev, [productId]: Math.max(0, (prev[productId] || 0) + delta) };
      const newTotal = Object.values(next).reduce((a, b) => a + b, 0);
      if (newTotal > totalBottles) return prev; // block over-selection
      return next;
    });
  };

  const handleSave = async () => {
    if (totalSelected !== totalBottles) {
      toast.error(`Please select exactly ${totalBottles} bottles total.`);
      return;
    }
    setSaving(true);
    const composition = Object.entries(counts)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({
        product_id: productId,
        product_name: products.find(p => p.id === productId)?.title || '',
        quantity,
      }));

    await base44.entities.Subscription.update(subscription.id, {
      custom_composition: composition,
    });
    setSaving(false);
    toast.success('Your juice mix has been updated!');
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="bg-card w-full rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-heading font-semibold text-base">Customize Your Mix</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose {totalBottles} bottles total
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Bottle counter */}
        <div className={`mb-4 px-3 py-2 rounded-xl text-center text-sm font-semibold ${
          totalSelected === totalBottles
            ? 'bg-primary/10 text-primary'
            : remaining > 0
            ? 'bg-secondary text-secondary-foreground'
            : 'bg-destructive/10 text-destructive'
        }`}>
          {totalSelected === totalBottles
            ? '✓ Perfect mix! Ready to save.'
            : remaining > 0
            ? `${remaining} bottle${remaining !== 1 ? 's' : ''} left to add`
            : `${Math.abs(remaining)} too many — remove some`}
        </div>

        {/* Products */}
        <div className="space-y-3 mb-6">
          {products.map(product => {
            const qty = counts[product.id] || 0;
            return (
              <div
                key={product.id}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  qty > 0 ? 'border-primary/50 bg-primary/5' : 'border-border/40 bg-background'
                }`}
              >
                {product.image_url && (
                  <img src={product.image_url} alt={product.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{product.title}</p>
                  {product.short_description && (
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-1">{product.short_description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => adjust(product.id, -1)}
                    disabled={qty === 0}
                    className="w-7 h-7 rounded-full border border-border flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{qty}</span>
                  <button
                    onClick={() => adjust(product.id, 1)}
                    disabled={totalSelected >= totalBottles}
                    className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl h-11">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || totalSelected !== totalBottles}
            className="flex-1 rounded-xl h-11 font-semibold"
          >
            {saving ? 'Saving...' : 'Save Mix'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}