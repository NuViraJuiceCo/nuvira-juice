import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Save, Star, CheckCircle2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [birthday, setBirthday] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Save form data to localStorage
  const saveToLocalStorage = (first, last, ph, addr, bd) => {
    const key = `accountSettings_${user?.email || 'guest'}`;
    localStorage.setItem(key, JSON.stringify({ first, last, ph, addr, bd }));
  };

  // Load form data from localStorage on mount (user-specific key)
  const loadFromLocalStorage = () => {
    const key = `accountSettings_${user?.email || 'guest'}`;
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : null;
  };

  useEffect(() => {
    const saved = loadFromLocalStorage();
    if (saved) {
      setFirstName(saved.first || '');
      setLastName(saved.last || '');
      setPhone(saved.ph || '');
      setAddress(saved.addr || '');
      setBirthday(saved.bd || '');
    } else if (user?.email) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      base44.entities.UserProfile.filter({ customer_email: user.email }).then(profiles => {
        const profile = profiles[0];
        const ph = profile?.phone || '';
        const addr = profile?.address || '';
        const bd = profile?.birthday || '';
        setPhone(ph);
        setAddress(addr);
        setBirthday(bd);
        saveToLocalStorage(user.first_name || '', user.last_name || '', ph, addr, bd);
      });
    }
  }, [user?.email]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      // Save to User entity (visible in dashboard)
      await base44.auth.updateMe({ 
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        birthday,
      });
      
      // Save additional profile data
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      if (profiles.length > 0) {
        await base44.entities.UserProfile.update(profiles[0].id, {
          phone,
          address,
          birthday,
        });
      } else {
        await base44.entities.UserProfile.create({
          customer_email: user?.email,
          phone,
          address,
          birthday,
        });
      }
      
      // Keep localStorage cache updated with latest saved data
      saveToLocalStorage(firstName, lastName, phone, address, birthday);
      
      // Sync to operations hub
      await base44.functions.invoke('syncUserToHub', {
        email: user?.email,
        first_name: firstName,
        last_name: lastName,
        phone,
        address,
        birthday,
      });
      
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        window.location.reload(); // Reload to refresh auth context with updated name
      }, 1500);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="pb-4">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-heading text-xl font-bold">Settings</h1>
      </div>

      <div className="px-4 space-y-5">
        {/* Profile */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Profile</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">First Name</Label>
                <Input value={firstName} onChange={e => {
                  const newVal = e.target.value;
                  setFirstName(newVal);
                  saveToLocalStorage(newVal, lastName, phone, address, birthday);
                }} className="rounded-xl h-11" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Last Name</Label>
                <Input value={lastName} onChange={e => {
                  const newVal = e.target.value;
                  setLastName(newVal);
                  saveToLocalStorage(firstName, newVal, phone, address, birthday);
                }} className="rounded-xl h-11" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input value={user?.email || ''} disabled className="rounded-xl h-11 bg-secondary/30 opacity-70" />
            </div>
            <p className="text-[10px] text-muted-foreground">Email is managed by your account and cannot be changed here.</p>
          </div>
        </div>

        {/* Contact */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contact</h2>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Phone Number</Label>
              <Input
                value={phone}
                onChange={e => {
                  const newVal = e.target.value;
                  setPhone(newVal);
                  saveToLocalStorage(firstName, lastName, newVal, address, birthday);
                }}
                placeholder="(555) 123-4567"
                className="rounded-xl h-11"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Default Delivery Address</Label>
              <AddressAutocomplete
                value={address}
                onChange={newVal => {
                  setAddress(newVal);
                  saveToLocalStorage(firstName, lastName, phone, newVal, birthday);
                }}
                placeholder="123 Main St, City, State"
                className="rounded-xl h-11"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Birthday (for your free annual bottle 🎂)</Label>
              <Input
                type="date"
                value={birthday}
                onChange={e => {
                  const newVal = e.target.value;
                  setBirthday(newVal);
                  saveToLocalStorage(firstName, lastName, phone, address, newVal);
                }}
                className="rounded-xl h-11"
              />
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full h-11 rounded-xl font-semibold">
          {saveSuccess ? (
            <>
              <Check className="w-4 h-4 mr-2" />
              Saved!
            </>
          ) : isSaving ? (
            'Saving...'
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>

        {/* Account Deletion */}
        <div className="pt-4 border-t border-border">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-destructive mb-2">Danger Zone</h2>
          <p className="text-xs text-muted-foreground mb-3">Deleting your account is permanent and cannot be undone.</p>
          <Button
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
            className="w-full h-11 rounded-xl font-semibold"
          >
            Delete My Account
          </Button>
        </div>
      </div>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All your data, orders, and points will be removed.
              Type <strong>DELETE</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full h-10 rounded-lg border border-input px-3 text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== 'DELETE'}
              onClick={async () => {
                await base44.integrations.Core.SendEmail({
                  to: 'info@nuvirajuice.com',
                  subject: 'Account Deletion Request',
                  body: `User ${user?.email} (${firstName} ${lastName}) has requested account deletion.`,
                });
                setShowDeleteDialog(false);
                toast.success('Deletion request submitted. We will process it within 48 hours.');
              }}
            >
              Confirm Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}