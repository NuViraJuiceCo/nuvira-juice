import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { User, CheckCircle2 } from 'lucide-react';

export default function ProfileSetup({ onComplete }) {
  const { user, refreshUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);
  const [nameFromAuth, setNameFromAuth] = useState(false);

  useEffect(() => {
    if (!user?.email) {
      onComplete();
      return;
    }
    base44.entities.UserProfile.filter({ customer_email: user.email }).then(profiles => {
      const profile = profiles[0];
      // If profile already exists (any record), skip this step
      if (profile) {
        onComplete(false);
        return;
      }
      // Check if auth already provides name
      const authFirstName = user.first_name || '';
      const authLastName = user.last_name || '';
      setFirstName(authFirstName);
      setLastName(authLastName);

      if (authFirstName && authLastName) {
        // Name is fully provided by auth — silently create profile and move on
        base44.entities.UserProfile.create({ customer_email: user.email }).then(() => onComplete(false));
      } else {
        setNameFromAuth(!!(authFirstName || authLastName));
        setShow(true);
      }
    });
  }, [user?.email]);

  if (!show) return null;

  const canSubmit = firstName.trim() && lastName.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    await base44.auth.updateMe({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });

    // Create a minimal profile record to mark this step as done
    await base44.entities.UserProfile.create({ customer_email: user.email });

    setSaving(false);
    setDone(true);
    await refreshUser();
    setTimeout(() => onComplete(true), 1400);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-[100] bg-primary flex flex-col items-center justify-center px-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <CheckCircle2 className="w-16 h-16 text-white mb-4" />
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="font-heading text-2xl font-bold text-white mb-2">Welcome, {firstName}!</motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="text-primary-foreground/80 text-sm">Let's find your perfect juice.</motion.p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 pt-10 pb-6 bg-primary shrink-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-5 h-5 text-white" />
            <h1 className="font-heading text-xl font-bold text-white">What's your name?</h1>
          </div>
          <p className="text-primary-foreground/70 text-sm">Just so we know what to call you.</p>
        </motion.div>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4 max-w-md mx-auto"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">First Name</Label>
              <Input
                placeholder="John"
                value={firstName}
                onChange={(e) => !nameFromAuth && setFirstName(e.target.value)}
                readOnly={nameFromAuth}
                className={`rounded-lg h-11 ${nameFromAuth ? 'bg-muted/60 text-muted-foreground cursor-default' : ''}`}
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Last Name</Label>
              <Input
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-lg h-11"
              />
            </div>
          </div>
          {nameFromAuth && (
            <p className="text-[10px] text-muted-foreground">First name provided by your sign-in account.</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="w-full h-12 rounded-xl font-semibold text-base mt-2"
          >
            {saving ? 'Saving...' : 'Continue →'}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}