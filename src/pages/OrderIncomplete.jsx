import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XCircle, ShoppingCart, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SEO from '@/components/SEO';
import { motion } from 'framer-motion';

export default function OrderIncomplete() {
  const queryParams = new URLSearchParams(window.location.search);
  const reason = queryParams.get('reason') || 'checkout_cancelled';

  const isExpired = reason === 'checkout_expired';

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 pb-8 text-center">
      <SEO title="Checkout Not Completed" noindex={true} />

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-5"
      >
        <XCircle className="w-10 h-10 text-destructive" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center max-w-sm"
      >
        <h1 className="font-heading text-2xl font-bold mb-2">
          {isExpired ? 'Checkout Expired' : 'Checkout Not Completed'}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {isExpired
            ? 'Your checkout session expired before payment was completed. No NuVira order has been placed and no charge was made. You can safely return to your cart and start again.'
            : 'Your checkout was not completed. No NuVira order will be prepared and no charge was made. You can safely return to your cart when you\'re ready.'}
        </p>

        <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs text-cyan-800 font-semibold mb-1">Your cart is still saved</p>
          <p className="text-xs text-cyan-700 leading-relaxed">
            Your items are still in your cart. Return to checkout whenever you're ready — your juice selection is waiting for you.
          </p>
        </div>

        <div className="space-y-2.5 w-full">
          <Link to="/cart" className="block">
            <Button className="w-full h-11 rounded-xl font-semibold text-sm">
              <ShoppingCart className="w-4 h-4 mr-2" />
              Return to Cart
            </Button>
          </Link>
          <Link to="/" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl font-semibold text-sm">
              <Home className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}