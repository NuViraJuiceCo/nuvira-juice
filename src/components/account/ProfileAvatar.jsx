import React, { useState, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Camera, X, Loader2, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Compress/resize image before upload
async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      // Max size 400x400 for avatar
      const maxSize = 400;
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > maxSize) {
          height *= maxSize / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width *= maxSize / height;
          height = maxSize;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
        },
        'image/jpeg',
        0.8
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
}

export default function ProfileAvatar({ userProfile, size = 'large' }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const sizeClasses = {
    small: 'w-10 h-10',
    medium: 'w-14 h-14',
    large: 'w-16 h-16',
  };

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      // Compress image first
      const compressedFile = await compressImage(file);
      
      // Upload to Base44
      const uploadRes = await base44.integrations.Core.UploadFile({ file: compressedFile });
      return uploadRes.file_url;
    },
    onSuccess: async (photoUrl) => {
      // Update UserProfile with new photo URL
      if (userProfile?.id) {
        await base44.entities.UserProfile.update(userProfile.id, {
          profile_photo_url: photoUrl,
        });
      } else if (user?.email) {
        // Create profile if doesn't exist
        await base44.entities.UserProfile.create({
          customer_email: user.email,
          profile_photo_url: photoUrl,
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      toast.success('Profile photo updated!');
      setIsUploading(false);
      setShowMenu(false);
    },
    onError: (error) => {
      console.error('Upload error:', error);
      toast.error('Photo could not be uploaded. Please try again.');
      setIsUploading(false);
      setShowMenu(false);
    },
  });

  const removePhotoMutation = useMutation({
    mutationFn: async () => {
      if (userProfile?.id) {
        await base44.entities.UserProfile.update(userProfile.id, {
          profile_photo_url: null,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      toast.success('Profile photo removed');
      setShowMenu(false);
    },
    onError: () => {
      toast.error('Failed to remove photo');
      setShowMenu(false);
    },
  });

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Please upload a JPG or PNG image.');
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Please choose a smaller image.');
      return;
    }

    setIsUploading(true);
    uploadMutation.mutate(file);
  };

  const handleOpenMenu = () => {
    setShowMenu(true);
  };

  const handleCloseMenu = () => {
    setShowMenu(false);
  };

  const hasPhoto = !!userProfile?.profile_photo_url;

  return (
    <>
      {/* Avatar Container */}
      <div className="relative shrink-0">
        {/* Avatar Circle */}
        <button
          onClick={handleOpenMenu}
          disabled={isUploading}
          className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-primary/25 via-primary/15 to-accent/15 border-2 border-primary/30 dark:border-primary/40 shadow-lg overflow-hidden relative group hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {hasPhoto && !isUploading ? (
            <img
              src={userProfile.profile_photo_url}
              alt="Profile"
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-7 h-7 text-primary" />
          )}
          
          {/* Loading Overlay */}
          {isUploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
        </button>

        {/* Crown Badge - bottom-left to avoid conflict with camera */}
        {user && (
          <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 bg-gradient-to-br from-accent to-accent/80 rounded-full border-2 border-card flex items-center justify-center shadow-md">
            <Crown className="w-2.5 h-2.5 text-white" />
          </div>
        )}

        {/* Camera/Edit Icon - top-right, always visible for large avatars */}
        {size === 'large' && !isUploading && (
          <div className="absolute top-0 right-0 w-6 h-6 bg-primary rounded-full border-2 border-card flex items-center justify-center shadow-md">
            <Camera className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* Bottom Sheet Menu */}
      <AnimatePresence>
        {showMenu && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm"
              onClick={handleCloseMenu}
            />
            
            {/* Bottom Sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 bg-background rounded-t-2xl max-h-[40vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2 shrink-0">
                <div className="w-10 h-1 bg-border rounded-full" />
              </div>

              {/* Header */}
              <div className="px-5 py-2 pb-4 shrink-0">
                <p className="font-heading text-base font-bold text-center">Profile Photo</p>
              </div>

              {/* Actions */}
              <div className="px-5 pb-6 space-y-2 overflow-y-auto flex-1">
                {/* Upload Photo */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-card hover:bg-secondary/20 transition-colors disabled:opacity-50"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">
                      {hasPhoto ? 'Change Photo' : 'Upload Photo'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      JPG or PNG, max 5MB
                    </p>
                  </div>
                </button>

                {/* Remove Photo (only if photo exists) */}
                {hasPhoto && (
                  <button
                    onClick={() => removePhotoMutation.mutate()}
                    disabled={removePhotoMutation.isPending}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-destructive/25 bg-destructive/5 hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  >
                    <div className="w-9 h-9 rounded-lg bg-destructive/15 flex items-center justify-center shrink-0">
                      <X className="w-4 h-4 text-destructive" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-destructive">
                        Remove Photo
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Return to default avatar
                      </p>
                    </div>
                    {removePhotoMutation.isPending && (
                      <Loader2 className="w-4 h-4 text-destructive animate-spin" />
                    )}
                  </button>
                )}

                {/* Cancel - Secondary text button */}
                <button
                  onClick={handleCloseMenu}
                  disabled={isUploading}
                  className="w-full p-3.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary/20 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}