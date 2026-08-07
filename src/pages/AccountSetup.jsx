import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { Loader2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

export default function AccountSetup() {
  const { user, isLoadingAuth } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const isAppleRelay = user?.email?.includes('privaterelay.appleid.com');
  const [formData, setFormData] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    phone: '',
    birthday: '',
    address: { street: '', city: '', state: '', zip: '' },
    contact_email: '',
  });

  // Fetch existing profile if available
  useEffect(() => {
    if (!user?.email || isLoadingAuth) return;

    const fetchProfile = async () => {
      try {
        const profiles = await base44.entities.UserProfile.filter(
          { customer_email: user.email },
          undefined,
          1
        );
        if (profiles.length > 0) {
          const profile = profiles[0];
          setFormData(prev => ({
            ...prev,
            first_name: prev.first_name || profile.first_name || '',
            last_name: prev.last_name || profile.last_name || '',
            contact_email: prev.contact_email || profile.contact_email || '',
            phone: prev.phone || profile.phone || '',
            birthday: prev.birthday || profile.birthday || '',
            address: {
              street: prev.address?.street || profile.address?.split(',')[0]?.trim() || '',
              city: prev.address?.city || profile.address?.split(',')[1]?.trim() || '',
              state: prev.address?.state || profile.address?.split(',')[2]?.trim() || '',
              zip: prev.address?.zip || profile.address?.split(',')[3]?.trim() || '',
            },
          }));
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      }
    };

    fetchProfile();
  }, [user?.email, isLoadingAuth]);

  React.useEffect(() => {
    if (!isLoadingAuth && !user) {
      navigate('/rewards');
    }
  }, [isLoadingAuth, user, navigate]);

  // After successful completion, redirect immediately without waiting for profile query
  React.useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => {
        navigate('/shop');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, navigate]);

  if (isLoadingAuth || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAddressChange = (addr) => {
    setFormData(prev => ({ ...prev, address: addr }));
  };

  const validateForm = () => {
    const { first_name, last_name, phone, contact_email } = formData;
    if (!first_name?.trim() || !last_name?.trim()) {
      toast.error('Please enter your full name');
      return false;
    }
    if (isAppleRelay && (!contact_email?.trim() || !contact_email.includes('@'))) {
      toast.error('Please enter your real email address');
      return false;
    }
    if (!phone?.trim()) {
      toast.error('Please enter your phone number');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const addrString = [
        formData.address.street,
        formData.address.city,
        formData.address.state,
        formData.address.zip,
      ]
        .filter(Boolean)
        .join(', ');

      const setupPayload = {
        email: user.email,
        contact_email: isAppleRelay ? formData.contact_email.trim() : user.email,
        first_name: formData.first_name,
        last_name: formData.last_name,
        phone: formData.phone,
        birthday: formData.birthday,
        address: addrString,
      };
      const response = await base44.functions.fetch('completeAccountSetup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Id': appParams.appId,
        },
        body: JSON.stringify(setupPayload),
      });
      const responseData = await response.json().catch(() => null);

      if (response.ok && responseData?.success) {
        setIsComplete(true);
        // Force refetch immediately
        await queryClient.refetchQueries({ queryKey: ['user-onboarding-check'] });
        setTimeout(() => {
          navigate('/shop');
        }, 1500);
      } else {
        const errorMsg = responseData?.error || 'Failed to complete setup';
        toast.error(errorMsg);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Setup error:', err);
      toast.error(err?.response?.data?.error || err?.message || 'Failed to complete setup');
      setIsLoading(false);
    }
  };

  if (isComplete) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.2 }}
            className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <CheckCircle className="w-8 h-8 text-green-600" />
          </motion.div>
          <h2 className="font-heading text-2xl font-bold mb-2">All Set!</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your account is ready and you're enrolled in NuVira Rewards.
          </p>
          <p className="text-xs text-muted-foreground">Redirecting...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 px-4 py-4">
        <img src={LOGO_URL} alt="NuVira" className="h-6 mx-auto" />
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="font-heading text-2xl font-bold mb-2">Complete Your Profile</h1>
          <p className="text-sm text-muted-foreground">
            We only need your name and phone to activate rewards. You can add delivery details when you order.
          </p>
        </motion.div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Full Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first_name" className="text-xs font-semibold mb-1.5 block">
                First Name
              </Label>
              <Input
                id="first_name"
                name="first_name"
                value={formData.first_name}
                onChange={handleInputChange}
                placeholder="John"
                disabled={isLoading}
              />
            </div>
            <div>
              <Label htmlFor="last_name" className="text-xs font-semibold mb-1.5 block">
                Last Name
              </Label>
              <Input
                id="last_name"
                name="last_name"
                value={formData.last_name}
                onChange={handleInputChange}
                placeholder="Doe"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Real email for Apple relay users */}
          {isAppleRelay && (
            <div>
              <Label htmlFor="contact_email" className="text-xs font-semibold mb-1.5 block">
                Your Email Address
              </Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                value={formData.contact_email}
                onChange={handleInputChange}
                placeholder="you@example.com"
                disabled={isLoading}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Since you signed in with Apple, please enter your real email so we can reach you.
              </p>
            </div>
          )}

          {/* Phone */}
          <div>
            <Label htmlFor="phone" className="text-xs font-semibold mb-1.5 block">
              Phone Number
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              value={formData.phone}
              onChange={handleInputChange}
              placeholder="(555) 123-4567"
              disabled={isLoading}
            />
          </div>

          {/* Birthday */}
          <div>
            <Label htmlFor="birthday" className="text-xs font-semibold mb-1.5 block">
              Birthday <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="birthday"
              name="birthday"
              type="date"
              value={formData.birthday}
              onChange={handleInputChange}
              disabled={isLoading}
            />
          </div>

          {/* Address */}
          <div>
            <Label className="text-xs font-semibold mb-1.5 block">Delivery Address <span className="font-normal text-muted-foreground">(optional until checkout)</span></Label>
            <AddressAutocomplete
              value={formData.address}
              onChange={handleAddressChange}
              placeholder="123 Main St"
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-xl font-semibold mt-8"
          >
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isLoading ? 'Setting Up...' : 'Complete Setup'}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            🎁 You'll earn 250 bonus points just for joining!
          </p>
        </form>
      </div>
    </div>
  );
}
