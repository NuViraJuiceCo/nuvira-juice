import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Save, Star, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [birthday, setBirthday] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '');
      setPhone(user.phone || '');
      setAddress(user.default_address || '');
      setBirthday(user.birthday || '');
    }
  }, [user]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({ full_name: fullName });
      toast.success('Settings saved!');
    } catch (err) {
      toast.error('Failed to save settings');
      console.error(err);
    }
    setIsSaving(false);
  };

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
            <div>
              <Label className="text-xs text-muted-foreground">Full Name</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} className="rounded-xl h-11" />
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
                onChange={e => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                className="rounded-xl h-11"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Default Delivery Address</Label>
              <Input
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="123 Main St, City, State"
                className="rounded-xl h-11"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Birthday (for your free annual bottle 🎂)</Label>
              <Input
                type="date"
                value={birthday}
                onChange={e => setBirthday(e.target.value)}
                className="rounded-xl h-11"
              />
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving} className="w-full h-11 rounded-xl font-semibold">
          <Save className="w-4 h-4 mr-2" />
          {isSaving ? 'Saving...' : 'Save Changes'}
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
                  body: `User ${user?.email} (${user?.full_name}) has requested account deletion.`,
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