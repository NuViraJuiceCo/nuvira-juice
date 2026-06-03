import React from 'react';
import { Minus, Plus } from 'lucide-react';

export default function BundleComposer({ bundleSize, composition, juices, onChange }) {
  const used = composition.reduce((sum, c) => sum + c.quantity, 0);
  const remaining = bundleSize - used;

  const getQty = (juiceId) => composition.find(c => c.product_id === juiceId)?.quantity || 0;

  const adjust = (juice, delta) => {
    const current = getQty(juice.id);
    const next = current + delta;
    if (next < 0) return;
    if (delta > 0 && remaining <= 0) return;

    let updated = composition.filter(c => c.product_id !== juice.id);
    if (next > 0) {
      updated = [...updated, { product_id: juice.id, title: juice.title, image_url: juice.image_url, quantity: next }];
    }
    onChange(updated);
  };

  return (
    <div className="mt-3 bg-secondary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Customize Your Bundle</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${remaining === 0 ? 'bg-primary/15 text-primary' : 'bg-cyan-100 text-cyan-700'}`}>
          {remaining === 0 ? '✓ Full' : `${remaining} left`}
        </span>
      </div>
      {juices.map(juice => (
        <div key={juice.id} className="flex items-center gap-3 bg-card rounded-lg px-3 py-2">
          {juice.image_url && (
            <img src={juice.image_url} alt={juice.title} className="w-8 h-8 rounded-md object-cover shrink-0" />
          )}
          <p className="text-xs font-medium flex-1 truncate">{juice.title}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => adjust(juice, -1)}
              className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center disabled:opacity-30"
              disabled={getQty(juice.id) === 0}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-bold w-4 text-center">{getQty(juice.id)}</span>
            <button
              onClick={() => adjust(juice, 1)}
              className="w-11 h-11 rounded-full bg-secondary flex items-center justify-center disabled:opacity-30"
              disabled={remaining === 0}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}