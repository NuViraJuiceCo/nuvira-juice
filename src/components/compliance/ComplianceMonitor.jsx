import React from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';

export default function ComplianceMonitor({ compact = false }) {
  const handleOpenAgent = async () => {
    try {
      const whatsappUrl = base44.agents.getWhatsAppConnectURL('complianceMonitor');
      window.open(whatsappUrl, '_blank');
    } catch (error) {
      console.error('Error opening compliance monitor:', error);
    }
  };

  return (
    <Button
      onClick={handleOpenAgent}
      variant="outline"
      className={compact ? 'h-8 w-8 shrink-0 p-0' : 'flex gap-2'}
      aria-label="Ask Compliance AI"
      title="Ask Compliance AI"
    >
      <MessageSquare className="w-4 h-4" />
      {!compact && 'Ask Compliance AI'}
    </Button>
  );
}
