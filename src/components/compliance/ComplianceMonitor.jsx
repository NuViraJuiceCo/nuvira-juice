import React from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';

export default function ComplianceMonitor() {
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
      className="flex gap-2"
    >
      <MessageSquare className="w-4 h-4" />
      Ask Compliance AI
    </Button>
  );
}