import React from 'react';
import { AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * HealthAdvisory Component
 * Displays health advisory messaging across the purchase flow.
 * Variants: compact (cart), expanded (product), checkbox (checkout)
 */
export default function HealthAdvisory({ variant = 'compact' }) {
  if (variant === 'compact') {
    // Cart and general pages
    return (
      <motion.div 
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-3.5 border flex items-start gap-3"
        style={{
          background: 'rgba(11, 61, 46, 0.06)',
          borderColor: 'rgba(218, 165, 32, 0.25)',
        }}
      >
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'rgba(218, 165, 32, 0.6)' }} />
        <p className="text-xs text-foreground/70 leading-relaxed">
          If you are pregnant, nursing, immunocompromised, elderly, purchasing for a child, or managing a medical condition, please consult your healthcare provider before consuming fresh cold-pressed juices.
        </p>
      </motion.div>
    );
  }

  if (variant === 'expanded') {
    // Product detail pages
    return (
      <motion.div 
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl p-4 border"
        style={{
          background: 'rgba(11, 61, 46, 0.08)',
          borderColor: 'rgba(218, 165, 32, 0.3)',
        }}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'rgba(218, 165, 32, 0.7)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'rgba(218, 165, 32, 0.8)' }}>Before You Drink</p>
            <p className="text-xs text-foreground/70 leading-relaxed">
              NuVira juices are made with fresh fruits, vegetables, and functional ingredients. If you are pregnant, nursing, immunocompromised, elderly, purchasing for a child, taking medication, or managing a medical condition, please consult your healthcare provider before consuming. Our products are not intended to diagnose, treat, cure, or prevent any disease.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  if (variant === 'checkbox') {
    // Checkout acknowledgment - return null, caller handles the checkbox rendering
    return null;
  }

  return null;
}

// Health advisory metadata for versioning and compliance
export const HEALTH_ADVISORY_CONFIG = {
  version: '2026-05-13-v1',
  shortNotice: 'If you are pregnant, nursing, immunocompromised, elderly, purchasing for a child, or managing a medical condition, please consult your healthcare provider before consuming fresh cold-pressed juices.',
  checkboxLabel: 'I understand that NuVira juices are fresh cold-pressed beverages and that anyone who is pregnant, nursing, immunocompromised, elderly, purchasing for a child, taking medication, or managing a medical condition should consult a healthcare provider before consuming.',
  expandedAdvisory: 'NuVira juices are made with fresh fruits, vegetables, and functional ingredients. If you are pregnant, nursing, immunocompromised, elderly, purchasing for a child, taking medication, or managing a medical condition, please consult your healthcare provider before consuming. Our products are not intended to diagnose, treat, cure, or prevent any disease.',
  confirmationNotice: 'Reminder: Please refrigerate immediately and consult your healthcare provider before consuming if you are pregnant, nursing, immunocompromised, elderly, purchasing for a child, or managing a medical condition.'
};