import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export default function CustomerDialog({ open, onClose, title, description, children, busy = false, className, triggerRef }) {
  const returnFocus = useRef(null);
  // Safari may leave the page focused after a pointer click on the trigger.
  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
    <DialogContent
      className={cn('nv-customer-modal rounded-xl', className)}
      onOpenAutoFocus={() => { returnFocus.current = triggerRef?.current || document.activeElement; }}
      onCloseAutoFocus={event => {
        if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected) {
          event.preventDefault();
          returnFocus.current.focus();
        }
      }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={event => { if (busy) event.preventDefault(); }}
      aria-busy={busy}
    >
      <DialogHeader className="pr-7 text-left">
        <DialogTitle className="font-heading text-xl">{title}</DialogTitle>
        <DialogDescription className={description ? undefined : 'sr-only'}>{description || title}</DialogDescription>
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}
