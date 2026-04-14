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

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', address: '', birthday: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const setField = (field, val) => setForm(prev => ({ ...prev, [field]: val }));


  useEffect(() => {
    if (!user?.email) return;
    // Always load from DB as source of truth
    base44.entities.UserProfile.filter({ customer_email: user.email }).then(profiles => {
      const profile = profiles[0];
      const rawAddr = profile?.address || user?.address || '';
      const parts = rawAddr.split(',').map(s => s.trim());
      setForm({
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        phone: profile?.phone || user?.phone || '',
        address: { street: parts[0] || '', city: parts[1] || '', state: parts[2] || '', zip: parts[3] || '' },
        birthday: profile?.birthday || user?.birthday || '',
      });
    });
  }, [user?.email]);

  const handleSave = async () => {
    const { firstName, lastName, phone, address, birthday } = form;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const addrString = [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ');
      await base44.auth.updateMe({ first_name: firstName, last_name: lastName, phone, address: addrString, birthday });
      const profiles = await base44.entities.UserProfile.filter({ customer_email: user?.email });
      if (profiles.length > 0) {
        await base44.entities.UserProfile.update(profiles[0].id, { phone, address: addrString, birthday });
      } else {
        await base44.entities.UserProfile.create({ customer_email: user?.email, phone, address: addrString, birthday });
      }
      await base44.functions.invoke('syncUserToHub', { email: user?.email, first_name: firstName, last_name: lastName, phone, address: addrString, birthday });
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); window.location.reload(); }, 1500);
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
                <Input value={form.firstName} onChange={e => setField('firstName', e.target.value)} className="rounded-xl h-11" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Last Name</Label>
                <Input value={form.lastName} onChange={e => setField('lastName', e.target.value)} className="rounded-xl h-11" />
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
              <Input value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="(555) 123-4567" className="rounded-xl h-11" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Default Delivery Address</Label>
              <AddressAutocomplete value={form.address} onChange={val => setField('address', val)} placeholder="123 Main St, City, State" className="rounded-xl h-11" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Birthday (for your free annual bottle 🎂)</Label>
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
                  body: `User ${user?.email} (${form.firstName} ${form.lastName}) has requested account deletion.`,
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