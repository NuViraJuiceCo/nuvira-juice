import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, Mail, Phone, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';

export default function LoyaltyMembers() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['loyalty-members'],
    queryFn: () => base44.entities.LoyaltyMember.filter({}, 'created_date', 200),
    enabled: user?.role === 'admin',
  });

  // Admin-only guard
  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Access denied. Admin only.</p>
      </div>
    );
  }

  const filteredMembers = members.filter(m => {
    const query = searchQuery.toLowerCase();
    return (
      m.full_name?.toLowerCase().includes(query) ||
      m.email?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/admin/orders">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Loyalty Members</span>
        <span className="ml-auto text-xs text-muted-foreground">{filteredMembers.length} members</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Members List */}
        <div className="space-y-2">
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && filteredMembers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No members found' : 'No loyalty members yet'}
            </div>
          )}

          {!isLoading && filteredMembers.map((member, i) => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-card border border-border/40 rounded-lg p-3 space-y-2"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{member.full_name || 'Unknown'}</p>
                  <div className="space-y-1 mt-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Mail className="w-3 h-3" />
                      {member.email}
                    </div>
                    {member.phone && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="w-3 h-3" />
                        {member.phone}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      Joined {new Date(member.created_date || member.signup_date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-primary">
                    {member.total_points || 0} pts
                  </div>
                  <div className={`text-xs font-medium mt-1 px-2 py-0.5 rounded ${
                    member.is_active 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {member.is_active ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}