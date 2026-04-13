import React from 'react';
import { Input } from '@/components/ui/input';

export default function AddressAutocomplete({ value, onChange, placeholder, className }) {
  return (
    <Input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || '123 Main St, City, State'}
      className={className}
      autoComplete="street-address"
    />
  );
}