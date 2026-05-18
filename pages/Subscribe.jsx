import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

export default function Subscribe() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Subscribe & Save</span>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden" style={{ height: '200px' }}>
        <img
          src="https://media.base44.com/images/public/69d48d0c39891f7945481152/9009cffcd_DSC02696.jpg"
          alt="NuVira subscription delivery"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/60 to-primary/20" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
          <img src={LOGO_URL} alt="NuVira" className="h-9 mb-2 brightness-0 invert opacity-90" />
          <h1 className="font-heading text-2xl font-bold text-white mb-1">Wellness on Autopilot</h1>
          <p className="text-white/80 text-sm leading-relaxed">
            Fresh juice delivered on your schedule.
          </p>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <div className="px-5 py-10 flex flex-col items-center text-center max-w-sm mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5"
        >
          <Clock className="w-7 h-7 text-primary" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <h2 className="font-heading text-xl font-bold mb-3">Subscription Plans Coming Soon</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-6">
            Subscription plans are currently being refined and will return soon. One-time orders are still available.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="w-full space-y-3"
        >
          <Link to="/shop" className="block">
            <Button className="w-full h-12 rounded-xl font-semibold text-sm">
              <ShoppingBag className="w-4 h-4 mr-2" />
              Shop One-Time Orders
            </Button>
          </Link>
          <Link to="/support" className="block">
            <Button variant="outline" className="w-full h-11 rounded-xl text-sm">
              Contact Us
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}