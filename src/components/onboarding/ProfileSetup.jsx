import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { User, CheckCircle2 } from 'lucide-react';

export default function ProfileSetup({ onComplete }) {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [birthday, setBirthday] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user?.email) {
      onComplete();
      return;
    }
    // Fast path: localStorage flag
    if (localStorage.getItem(`profileComplete_${user.email}`)) {
      onComplete();
      return;
    }
    // Server check
    base44.entities.UserProfile.filter({ customer_email: user.email }).then(profiles => {
      const profile = profiles[0];
      if (profile?.phone) {
        localStorage.setItem(`profileComplete_${user.email}`, '1');
        onComplete();
      } else {
        // Pre-fill any existing data
        setFirstName(user.first_name || '');
        setLastName(user.last_name || '');
        if (profile?.address) setAddress(profile.address);
        if (profile?.birthday) setBirthday(profile.birthday);
        setShow(true);
      }
    });
  }, [user?.email]);

  if (!show) return null;

  const canSubmit = firstName.trim() && lastName.trim() && phone.trim();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    // Save name to User entity
    await base44.auth.updateMe({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });

    // Save profile details to UserProfile entity
    const profiles = await base44.entities.UserProfile.filter({ customer_email: user.email });
    const profileData = { phone: phone.trim(), address: address.trim(), birthday };
    if (profiles.length > 0) {
      await base44.entities.UserProfile.update(profiles[0].id, profileData);
    } else {
      await base44.entities.UserProfile.create({ customer_email: user.email, ...profileData });
    }

    // Sync to operations hub
    try {
      await base44.functions.invoke('syncUserToHub', {
        email: user.email,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        birthday,
      });
    } catch (e) {
      // non-critical
    }

    // Cache in localStorage so AccountSettings and Home reflect immediately
    localStorage.setItem(`accountSettings_${user.email}`, JSON.stringify({
      first: firstName.trim(),
      last: lastName.trim(),
      ph: phone.trim(),
      addr: address.trim(),
      bd: birthday,
    }));
    localStorage.setItem(`profileComplete_${user.email}`, '1');

    setSaving(false);
    setDone(true);
    setTimeout(() => {
      onComplete();
      window.location.reload();
    }, 1600);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-[100] bg-primary flex flex-col items-center justify-center px-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <CheckCircle2 className="w-16 h-16 text-white mb-4" />
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="font-heading text-2xl font-bold text-white mb-2">You're all set, {firstName}!</motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="text-primary-foreground/80 text-sm">Your profile is ready.</motion.p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col" style={{ overflowY: 'auto' }}>
      {/* Header */}
      <div className="px-6 pt-10 pb-6 bg-primary shrink-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-5 h-5 text-white" />
            <h1 className="font-heading text-xl font-bold text-white">Complete Your Profile</h1>
          </div>
          <p className="text-primary-foreground/70 text-sm">We need a few details to get your orders to you.</p>
        </motion.div>
      </div>

      {/* Form */}
      <div className="flex-1 px-6 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4 max-w-md mx-auto"
        >
          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">First Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-lg h-11"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Last Name <span className="text-destructive">*</span></Label>
              <Input
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-lg h-11"
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Phone Number <span className="text-destructive">*</span></Label>
            <Input
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg h-11"
              type="tel"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Used for delivery updates only.</p>
          </div>

          {/* Address */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Default Delivery Address</Label>
            <Input
              placeholder="123 Main St, Wentzville, MO"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="rounded-lg h-11"
            />
          </div>

          {/* Birthday */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Birthday 🎂 <span className="text-[10px] text-muted-foreground">(free bottle on your birthday!)</span>
            </Label>
            <Input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="rounded-lg h-11"
            />
          </div>

          <p className="text-[10px] text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required.</p>

          {/* Save Button — always visible inside the form */}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="w-full h-12 rounded-xl font-semibold text-base mt-4"
          >
            {saving ? 'Saving...' : 'Save & Continue →'}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}