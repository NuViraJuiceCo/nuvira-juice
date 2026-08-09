import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import NotificationPreferencesPanel from '@/components/NotificationPreferencesPanel';

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, logout, refreshUser } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', address: '', birthday: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const setField = (field, val) => setForm(prev => ({ ...prev, [field]: val }));


  useEffect(() => {
    if (!user?.email) return;
    // Always load from DB as source of truth
    base44.entities.UserProfile.filter({ customer_email: user.email }).then(profiles => {
      const profile = profiles[0];
      const rawAddr = profile?.address || user?.address || '';
      const parts = rawAddr.split(',').map(s => s.trim());
      setForm({
        firstName: profile?.first_name || user.first_name || '',
        lastName: profile?.last_name || user.last_name || '',
        phone: profile?.phone || user?.phone || '',
        address: { street: parts[0] || '', city: parts[1] || '', state: parts[2] || '', zip: parts[3] || '' },
        birthday: profile?.birthday || user?.birthday || '',
      });
    });
  }, [user?.email]);

  const handleSave = async () => {
    const { firstName, lastName, phone, address, birthday } = form;
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    if (!normalizedFirstName || !normalizedLastName) {
      toast.error('First and last name are required');
      return;
    }
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      if (profiles.length > 0) {
        await base44.entities.UserProfile.update(profiles[0].id, {
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          phone,
          address: addrString,
          birthday,
        });
      } else {
        await base44.entities.UserProfile.create({
          customer_email: user?.email,
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          phone,
          address: addrString,
          birthday,
        });
      }
      await base44.auth.updateMe({ first_name: normalizedFirstName, last_name: normalizedLastName, phone, address: addrString, birthday });
      setSaveSuccess(true);
      await refreshUser();
      setTimeout(() => { setSaveSuccess(false); }, 1500);
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || isDeleting) return;
    setIsDeleting(true);
    try {
      const response = await base44.functions.invoke('requestAccountDeletion', {
        confirm: 'DELETE',
        source: 'account_settings',
      });

      if (!response?.data?.success) {
        throw new Error(response?.data?.error || 'Account deletion failed');
      }

      setShowDeleteDialog(false);
      setDeleteConfirm('');
      toast.success('Your account deletion request has been completed.');
      await logout(false);
      navigate('/', { replace: true });
    } catch (error) {
      console.error('Delete account error:', error);
      toast.error('Unable to delete account right now. Please try again or contact NuVira support.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="pb-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        <button onClick={() => navigate(-1)} aria-label="Go back" className="w-11 h-11 flex items-center justify-center -ml-2 active:bg-secondary rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-heading text-lg font-bold">Settings</h1>
      </div>

      <div className="px-4 space-y-5">
        {/* Profile */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-3">Profile</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-foreground/65 font-medium">First Name</Label>
                <Input value={form.firstName} onChange={e => setField('firstName', e.target.value)} className="rounded-xl h-11" />
              </div>
              <div>
                <Label className="text-xs text-foreground/65 font-medium">Last Name</Label>
                <Input value={form.lastName} onChange={e => setField('lastName', e.target.value)} className="rounded-xl h-11" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-foreground/65 font-medium">Email</Label>
              <Input value={user?.email || ''} disabled className="rounded-xl h-11 bg-secondary/30 opacity-70" />
            </div>
            <p className="text-[10px] text-muted-foreground">Email is managed by your account and cannot be changed here.</p>
          </div>
        </div>

        {/* Contact */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground/55 mb-3">Contact</h2>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-foreground/65 font-medium">Phone Number</Label>
              <Input value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="(555) 123-4567" className="rounded-xl h-11" />
            </div>
            <div>
              <Label className="text-xs text-foreground/65 font-medium">Default Delivery Address</Label>
              <AddressAutocomplete value={form.address} onChange={val => setField('address', val)} placeholder="123 Main St, City, State" className="rounded-xl h-11" />
            </div>
            <div>
              <Label className="text-xs text-foreground/65 font-medium">Birthday (for your free annual bottle 🎂)</Label>
              <Input type="date" value={form.birthday} onChange={e => setField('birthday', e.target.value)} className="rounded-xl h-11" />
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

        {/* Notification Preferences */}
        <div className="pt-2 border-t border-border/50">
          <NotificationPreferencesPanel />
        </div>

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
              This permanently removes your NuVira app profile, notification preferences, saved device tokens,
              loyalty profile, and rewards records. NuVira may retain order, payment, refund, tax, fulfillment,
              delivery, sync, and food-safety records when required for business, legal, or compliance reasons.
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
              disabled={deleteConfirm !== 'DELETE' || isDeleting}
              onClick={handleDeleteAccount}
            >
              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
