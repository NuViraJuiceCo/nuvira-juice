import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, MapPin, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCart } from '@/lib/cartContext';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getDeliveryDisplayText, getNextDeliveryDate } from '@/lib/deliveryUtils';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function Checkout() {
  const navigate = useNavigate();
  const { items, subtotal, clearCart } = useCart();
  const { user } = useAuth();
  const [fulfillmentType, setFulfillmentType] = useState('delivery');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: schedules = [] } = useQuery({
    queryKey: ['delivery-schedule'],
    queryFn: () => base44.entities.DeliverySchedule.filter({ is_active: true }),
  });

  const scheduleRules = schedules[0]?.rules || [];
  const deliveryDate = getNextDeliveryDate(scheduleRules);
  const deliveryText = getDeliveryDisplayText(scheduleRules, fulfillmentType);
  const deliveryFee = fulfillmentType === 'delivery' ? 5.00 : 0;
  const total = subtotal + deliveryFee;

  const handlePlaceOrder = async () => {
    if (fulfillmentType === 'delivery' && !address.trim()) {
      toast.error('Please enter a delivery address');
      return;
    }
    if (!phone.trim()) {
      toast.error('Please enter your phone number');
      return;
    }

    setIsSubmitting(true);
    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    const order = await base44.entities.Order.create({
      order_number: orderNumber,
      customer_email: user?.email || 'guest@nuvira.com',
      items: items.map(i => ({
        product_id: i.product_id,
        title: i.title,
        price: i.price,
        quantity: i.quantity,
        image_url: i.image_url,
      })),
      subtotal,
      delivery_fee: deliveryFee,
      total,
      fulfillment_type: fulfillmentType,
      delivery_address: address,
      contact_phone: phone,
      estimated_delivery_date: deliveryDate ? format(deliveryDate, 'yyyy-MM-dd') : null,
      status: 'order_received',
      status_history: [{
        status: 'order_received',
        timestamp: new Date().toISOString(),
        message: "We've received your order!",
      }],
    });

    clearCart();
    navigate(`/order-confirmation/${order.id}`);
  };

  if (items.length === 0) {
    navigate('/cart');
    return null;
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Checkout</h1>
      </div>

      {/* Delivery Estimate */}
      <div className="mx-4 mb-5 bg-primary/5 rounded-xl p-3.5 flex items-center gap-2.5">
        <Truck className="w-5 h-5 text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-primary">{deliveryText}</p>
          <p className="text-[10px] text-muted-foreground">Included in our next fresh batch</p>
        </div>
      </div>

      {/* Fulfillment Type */}
      <div className="px-4 mb-5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
          Fulfillment
        </Label>
        <RadioGroup value={fulfillmentType} onValueChange={setFulfillmentType} className="flex gap-3">
          <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
            fulfillmentType === 'delivery' ? 'border-primary bg-primary/5' : 'border-border'
          }`}>
            <RadioGroupItem value="delivery" />
            <Truck className="w-4 h-4" />
            <span className="text-sm font-medium">Delivery</span>
          </label>
          <label className={`flex-1 flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
            fulfillmentType === 'pickup' ? 'border-primary bg-primary/5' : 'border-border'
          }`}>
            <RadioGroupItem value="pickup" />
            <Package className="w-4 h-4" />
            <span className="text-sm font-medium">Pickup</span>
          </label>
        </RadioGroup>
      </div>

      {/* Contact */}
      <div className="px-4 space-y-4 mb-5">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Phone Number
          </Label>
          <Input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="rounded-xl h-11"
          />
        </div>
        {fulfillmentType === 'delivery' && (
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Delivery Address
            </Label>
            <Input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              className="rounded-xl h-11"
            />
          </div>
        )}
      </div>

      {/* Order Summary */}
      <div className="mx-4 bg-secondary/40 rounded-xl p-4 mb-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Order Summary</h3>
        {items.map(item => (
          <div key={item.product_id} className="flex justify-between text-sm mb-1.5">
            <span className="text-foreground/80">{item.quantity}x {item.title}</span>
            <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="border-t border-border/50 mt-2 pt-2">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{fulfillmentType === 'delivery' ? 'Delivery' : 'Pickup'}</span>
            <span>{deliveryFee > 0 ? `$${deliveryFee.toFixed(2)}` : 'Free'}</span>
          </div>
          <div className="flex justify-between text-sm font-bold mt-1.5">
            <span>Total</span><span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Place Order */}
      <div className="px-4">
        <Button
          onClick={handlePlaceOrder}
          disabled={isSubmitting}
          className="w-full h-12 rounded-xl font-semibold text-sm"
        >
          {isSubmitting ? 'Placing Order...' : `Place Order · $${total.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}