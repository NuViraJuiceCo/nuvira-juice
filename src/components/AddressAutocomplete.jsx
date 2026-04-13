import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';

export default function AddressAutocomplete({ value, onChange, placeholder, className }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  const fetchSuggestions = (query) => {
    if (!query || query.length < 3) { setSuggestions([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const res = await base44.functions.invoke('addressSuggest', { query });
      const list = res.data?.suggestions || [];
      setSuggestions(list);
      setOpen(list.length > 0);
    }, 350);
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    fetchSuggestions(e.target.value);
  };

  const handleSelect = (addr) => {
    onChange(addr);
    setSuggestions([]);
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder || '123 Main St, City, State'}
        className={className}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-card border border-border rounded-xl shadow-lg max-h-52 overflow-y-auto text-sm">
          {suggestions.map((s, i) => (
            <li
              key={i}
              onMouseDown={() => handleSelect(s)}
              className="px-3 py-2.5 cursor-pointer hover:bg-secondary transition-colors first:rounded-t-xl last:rounded-b-xl"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}