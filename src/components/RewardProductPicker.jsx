import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, Gift, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { earnedRewardCartItems, rewardProductEligible, rewardSelectionCount } from '@/lib/rewardSelection';

function BottleImage({ product }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.image_url]);
  return product.image_url && !failed
    ? <img src={product.image_url} onError={() => setFailed(true)} alt={product.title} className="h-full w-full object-contain p-1" />
    : <Gift aria-hidden="true" className="h-6 w-6 text-primary/60" />;
}

export default function RewardProductPicker({ open, onClose, onSelect, reward }) {
  const [quantities, setQuantities] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const required = rewardSelectionCount(reward);
  const selectedCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const upgrade = reward?.reward_type === 'bundle_upgrade';
  useEffect(() => { setQuantities({}); setError(''); }, [open, reward?.id]);
  const { data: products = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['earned-reward-picker-products'],
    queryFn: async () => {
      const rows = await base44.entities.Product.filter({ is_available: true }, 'sort_order', 250);
      if (!Array.isArray(rows) || rows.length >= 250) throw new Error('The complete product selection could not be loaded.');
      return rows;
    },
    enabled: open,
  });
  const eligible = products.filter(product => rewardProductEligible(reward, product));
  const change = (id, delta) => {
    if (savingRef.current) return;
    setQuantities(previous => {
      const count = Object.values(previous).reduce((sum, value) => sum + value, 0);
      const next = (previous[id] || 0) + delta;
      return next < 0 || next > required || count + delta > required ? previous : { ...previous, [id]: next };
    });
    setError('');
  };
  const confirm = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const fresh = await refetch();
      if (fresh.isError || !Array.isArray(fresh.data)) throw new Error('We could not refresh the product selection. Please try again.');
      const availableIds = new Set(fresh.data.filter(product => rewardProductEligible(reward, product)).map(product => product.id));
      if (Object.entries(quantities).some(([id, quantity]) => quantity > 0 && !availableIds.has(id))) {
        // A removed product must not leave an invisible quantity consuming the
        // selection limit. Keep other choices and let the customer replace it.
        setQuantities(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => availableIds.has(id))));
        throw new Error('An item is no longer available. Please update your selection. Your points have not been used.');
      }
      const choices = Object.entries(quantities).filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({ product: fresh.data.find(product => product.id === id), quantity }));
      earnedRewardCartItems(reward, choices);
      await onSelect(choices);
    } catch (failure) {
      setError(failure?.message || 'We could not save your selection. Your points have not been used.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return <Dialog open={open} onOpenChange={next => { if (!next && !savingRef.current) onClose(); }}>
    <DialogContent className="block max-w-xl rounded-3xl p-0">
      <DialogHeader className="border-b border-border bg-gradient-to-br from-primary/15 via-card to-card px-5 pb-5 pt-6 pr-12 text-left">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Made yours · Earned by you</p>
        <DialogTitle className="font-heading text-xl">{reward?.title || 'Choose your reward'}</DialogTitle>
        <DialogDescription className="pt-2 leading-relaxed">
          {upgrade ? 'Choose 3 additional 12oz bottles at half price. Add them to an order of at least 3 regular bottles.'
            : required === 6 ? 'Choose your 6 included 12oz bottles. Mix your favorites or choose one flavor. No extra merchandise is required.'
              : `Choose your included ${reward?.reward_type === 'free_shot' ? '2oz wellness shot' : '12oz bottle'}. It counts toward the usual order minimum.`}
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {(error || isError) && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error || 'Products could not be loaded. Please try again.'}</p>}
        {isError && <button type="button" onClick={() => refetch()} className="min-h-11 text-sm font-semibold text-primary">Retry loading products</button>}
        {isLoading && <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm"><Loader2 className="h-5 w-5 animate-spin" /> Loading your selection</div>}
        {!isLoading && !isError && eligible.length === 0 && <p className="py-6 text-sm text-muted-foreground">No eligible items are available right now. Your points have not been used.</p>}
        {!isLoading && eligible.map(product => <div key={product.id} className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${quantities[product.id] ? 'border-primary/45 bg-primary/5' : 'border-border bg-secondary/25'}`}>
          <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background/60"><BottleImage product={product} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug">{product.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{product.size} · {upgrade ? 'Half price' : 'Included'}</p>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" aria-label={`Remove one ${product.title}`} disabled={saving || !quantities[product.id]} onClick={() => change(product.id, -1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-border disabled:opacity-35"><Minus className="h-4 w-4" /></button>
              <output aria-label={`${product.title} quantity`} className="w-7 text-center text-sm font-bold tabular-nums">{quantities[product.id] || 0}</output>
              <button type="button" aria-label={`Add one ${product.title}`} disabled={saving || selectedCount >= required} onClick={() => change(product.id, 1)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary disabled:opacity-35"><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        </div>)}
      </div>
      <div className="border-t border-border bg-card px-5 py-4">
        <p role="status" aria-live="polite" className="mb-3 text-sm font-medium">{selectedCount} of {required} selected</p>
        <button type="button" disabled={saving || isLoading || isError || selectedCount !== required || required === 0} onClick={confirm} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-nuvira-gradient px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/15 disabled:opacity-40">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saving ? 'Confirming your selection…' : 'Add reward to my order'}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">Points are used only when your order is placed. Delivery charges and applicable fees still apply.</p>
      </div>
    </DialogContent>
  </Dialog>;
}
