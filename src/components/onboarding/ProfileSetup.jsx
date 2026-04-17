import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { User, Mail, CheckCircle2 } from 'lucide-react';

export default function ProfileSetup({ onComplete }) {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(1); // 1 = name, 2 = email
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
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
      if (profile) {
        onComplete(false);
        return;
      }
      const authFirstName = user.first_name || '';
      const authLastName = user.last_name || '';
      setFirstName(authFirstName);
      setLastName(authLastName);
      // Pre-fill with auth email as a starting point
      setContactEmail(user.email || '');

      if (authFirstName && authLastName) {
        // Name provided — skip to email step
        setNameFromAuth(true);
        setStep(2);
        setShow(true);
      } else {
        setNameFromAuth(!!(authFirstName || authLastName));
        setShow(true);
      }
    });
  }, [user?.email]);

  if (!show) return null;

  const canSubmitName = firstName.trim() && lastName.trim();
  const canSubmitEmail = contactEmail.trim() && contactEmail.includes('@');

  const handleNameNext = () => {
    if (!canSubmitName) return;
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!canSubmitEmail) return;
    setSaving(true);

    await base44.auth.updateMe({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });

    // Create profile with the confirmed contact email
    await base44.entities.UserProfile.create({
      customer_email: user.email,
      contact_email: contactEmail.trim(),
    });

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
      {/* Close / skip button */}
      <button
        onClick={() => onComplete(false)}
        className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
        aria-label="Skip for now"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      {/* Header */}
      <div className="px-6 pt-10 pb-6 bg-primary shrink-0">
        {/* Progress dots */}
        <div className="flex gap-1.5 mb-5">
          <div className={`h-1 rounded-full flex-1 transition-all duration-500 bg-white ${step >= 1 ? 'opacity-100' : 'opacity-30'}`} />
          <div className={`h-1 rounded-full flex-1 transition-all duration-500 bg-white ${step >= 2 ? 'opacity-100' : 'opacity-30'}`} />
        </div>
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="name-header" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex items-center gap-2 mb-1">
                  <User className="w-5 h-5 text-white" />
                  <h1 className="font-heading text-xl font-bold text-white">What's your name?</h1>
                </div>
                <p className="text-primary-foreground/70 text-sm">Just so we know what to call you.</p>
              </motion.div>
            ) : (
              <motion.div key="email-header" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="w-5 h-5 text-white" />
                  <h1 className="font-heading text-xl font-bold text-white">Confirm your email</h1>
                </div>
                <p className="text-primary-foreground/70 text-sm">We'll use this for order updates & delivery notifications.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 py-8">
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="name-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
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
                onClick={handleNameNext}
                disabled={!canSubmitName}
                className="w-full h-12 rounded-xl font-semibold text-base mt-2"
              >
                Continue →
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="email-form"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 max-w-md mx-auto"
            >
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Contact Email</Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="rounded-lg h-11"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <p className="text-[10px] text-muted-foreground mt-2">
                  If you used "Sign in with Apple," your real email may differ. Enter the one you actually check.
                </p>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!canSubmitEmail || saving}
                className="w-full h-12 rounded-xl font-semibold text-base"
              >
                {saving ? 'Saving...' : 'Get Started →'}
              </Button>
              {!nameFromAuth && (
                <button onClick={() => setStep(1)} className="w-full text-center text-xs text-muted-foreground underline">
                  Back
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}