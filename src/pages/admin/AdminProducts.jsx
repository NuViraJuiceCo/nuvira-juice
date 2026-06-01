import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Check, X, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';

function ProductImageUploader({ product, onUpdated }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      await base44.functions.invoke('updateAdminProductCatalogItem', {
        product_id: product.id,
        image_url: file_url,
      });
      onUpdated();
      toast.success('Image updated!');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="relative group cursor-pointer" onClick={() => inputRef.current?.click()}>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      <div className="w-16 h-16 rounded-xl overflow-hidden bg-secondary/50 border border-border shrink-0">
        {product.image_url ? (
          <img src={product.image_url} alt={product.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl">🍊</div>
        )}
      </div>
      <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        {uploading ? (
          <Loader2 className="w-4 h-4 text-white animate-spin" />
        ) : (
          <ImagePlus className="w-4 h-4 text-white" />
        )}
      </div>
    </div>
  );
}

function ProductRow({ product, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(product.title);
  const [price, setPrice] = useState(product.price);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await base44.functions.invoke('updateAdminProductCatalogItem', {
      product_id: product.id,
      title,
      price,
    });
    setSaving(false);
    setEditing(false);
    onUpdated();
    toast.success('Product updated');
  };

  return (
    <div className="bg-card rounded-2xl border border-border/50 p-3 flex items-center gap-3">
      <ProductImageUploader product={product} onUpdated={onUpdated} />

      <div className="flex-1 min-w-0">
        {editing ? (
          <div className="space-y-1.5">
            <input
              className="w-full text-sm font-semibold bg-secondary rounded-lg px-2 py-1 border border-border outline-none"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">$</span>
              <input
                type="number"
                step="0.01"
                className="w-24 text-xs bg-secondary rounded-lg px-2 py-1 border border-border outline-none"
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold truncate">{product.title}</p>
            <p className="text-xs text-muted-foreground">${product.price?.toFixed(2)} · {product.category}</p>
            <p className={`text-[10px] mt-0.5 font-medium ${product.is_available ? 'text-green-600' : 'text-red-500'}`}>
              {product.is_available ? 'Available' : 'Unavailable'}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => { setEditing(false); setTitle(product.title); setPrice(product.price); }}
              className="w-8 h-8 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="w-8 h-8 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminProducts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['admin-products'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminLaunchReadOnlySummary', {
        resource: 'product_catalog',
      });
      const payload = res?.data || res;
      return Array.isArray(payload?.rows) ? payload.rows : [];
    },
    enabled: user?.role === 'admin',
  });

  const filtered = products.filter(p =>
    p.title?.toLowerCase().includes(search.toLowerCase())
  );

  const handleUpdated = () => {
    [
      ['admin-products'],
      ['products'],
      ['admin-operations-dashboard-summary'],
      ['admin-production-planning-summary'],
      ['admin-inventory-status-summary'],
      ['admin-calendar-events-summary'],
      ['admin-shopify-ops-summary'],
    ].forEach(queryKey => {
      queryClient.invalidateQueries({ queryKey });
    });
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Access denied. Admins only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Product Images"
        subtitle="Tap an image to upload a new one"
        badge="Admin"
        badgeTone="native"
        onBack={() => navigate('/account')}
      />

      {/* Search */}
      <div className="px-4 mt-4 mb-3">
        <input
          className="w-full bg-card border border-border rounded-xl px-3 py-2 text-sm outline-none"
          placeholder="Search products..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      <div className="px-4 space-y-2.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-16">No products found</p>
        ) : (
          filtered.map(product => (
            <ProductRow key={product.id} product={product} onUpdated={handleUpdated} />
          ))
        )}
      </div>
    </div>
  );
}
