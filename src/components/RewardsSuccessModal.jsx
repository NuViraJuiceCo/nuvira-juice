import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RewardsSuccessModal({ open, onClose, email, name }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-card rounded-3xl p-8 max-w-sm shadow-2xl"
          >
            {/* Success Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', delay: 0.2, damping: 15 }}
              className="w-16 h-16 nuvira-icon-badge rounded-full flex items-center justify-center mx-auto mb-5"
            >
              <Check className="w-8 h-8 text-white" />
            </motion.div>

            {/* Content */}
            <h2 className="font-heading text-2xl font-bold text-center mb-2">
              🎉 Welcome to NuVira!
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-5">
              Your loyalty account is ready, {name}!
            </p>

            {/* Confirmation Details */}
            <div className="bg-nuvira-gradient-soft border border-nuvira rounded-xl p-4 mb-5 space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🎁</span>
                <div>
                  <p className="text-sm font-semibold">250 Bonus Points</p>
                  <p className="text-xs text-muted-foreground">Instant reward for joining</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">Confirmation Sent</p>
                  <p className="text-xs text-muted-foreground">{email}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-2xl">⭐</span>
                <div>
                  <p className="text-sm font-semibold">Start Earning</p>
                  <p className="text-xs text-muted-foreground">10 points per $1 spent</p>
                </div>
              </div>
            </div>

            {/* Close Button */}
            <Button
              onClick={onClose}
              className="w-full h-11 rounded-xl font-semibold nuvira-gradient-button"
            >
              Got It! 🙌
            </Button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
