import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { User } from 'lucide-react';

export default function ProfileSetup({ onComplete }) {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Don't show if user already has a full name (from Google SSO or already set)
  if (user?.full_name && user.full_name !== user.email) {
    onComplete();
    return null;
  }

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      return;
    }
    setSaving(true);
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    await base44.auth.updateMe({ full_name: fullName });
    setSaving(false);
    setDone(true);
    setTimeout(() => onComplete(), 1200);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 bg-primary flex flex-col items-center justify-center px-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <User className="w-16 h-16 text-white mb-4" />
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="font-heading text-2xl font-bold text-white mb-2">Welcome!</motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="text-primary-foreground/80 text-sm">Your profile is ready.</motion.p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 pt-10 pb-6 bg-primary">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-heading text-xl font-bold text-white mb-1"
        >
          Complete Your Profile
        </motion.h1>
        <p className="text-primary-foreground/70 text-sm">Help us personalize your experience.</p>
      </div>

      {/* Form */}
      <div className="flex-1 flex flex-col justify-center px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">First Name</Label>
            <Input
              placeholder="John"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="rounded-lg h-11"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Last Name</Label>
            <Input
              placeholder="Doe"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="rounded-lg h-11"
            />
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <div className="px-6 pb-6 pt-4 border-t border-border safe-area-bottom">
        <Button
          onClick={handleSubmit}
          disabled={!firstName.trim() || !lastName.trim() || saving}
          className="w-full h-11 rounded-lg font-semibold text-sm"
        >
          {saving ? 'Saving...' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}