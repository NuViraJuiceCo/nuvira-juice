import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';

/**
 * Props:
 *  value: { street, city, state, zip } | string (legacy single-line)
 *  onChange: (addr) => void  — called with the same shape as value
 *  className: string (applied to the street input)
 */
export default function AddressAutocomplete({ value, onChange, placeholder, className }) {
  // Support both object and legacy string modes
  const isObject = typeof value === 'object' && value !== null;
  const addr = isObject ? value : { street: value || '', city: '', state: '', zip: '' };

  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  const emit = (updated) => {
    if (isObject) {
      onChange(updated);
    } else {
      // Legacy: combine back to single string
      const parts = [updated.street, updated.city, updated.state, updated.zip].filter(Boolean);
      onChange(parts.join(', '));
    }
  };

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

  const handleStreetChange = (e) => {
    emit({ ...addr, street: e.target.value });
    fetchSuggestions(e.target.value);
  };

  const handleSelect = (s) => {
    emit({ street: s.street, city: s.city, state: s.state, zip: s.zip });
    setSuggestions([]);
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Street */}
      <div className="relative">
        <Input
          value={addr.street}
          onChange={handleStreetChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder || '123 Main St'}
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
                <span className="font-medium">{s.street}</span>
                {(s.city || s.state) && (
                  <span className="text-muted-foreground ml-1 text-xs">— {[s.city, s.state].filter(Boolean).join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* City / State / Zip */}
      <div className="grid grid-cols-5 gap-2">
        <div className="col-span-2">
          <Input
            value={addr.city}
            onChange={e => emit({ ...addr, city: e.target.value })}
            placeholder="City"
            className={className}
          />
        </div>
        <div className="col-span-1">
          <Input
            value={addr.state}
            onChange={e => emit({ ...addr, state: e.target.value })}
            placeholder="ST"
            maxLength={2}
            className={className}
          />
        </div>
        <div className="col-span-2">
          <Input
            value={addr.zip}
            onChange={e => emit({ ...addr, zip: e.target.value })}
            placeholder="ZIP"
            maxLength={10}
            className={className}
          />
        </div>
      </div>
    </div>
  );
}