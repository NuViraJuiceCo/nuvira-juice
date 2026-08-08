import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { invokeCustomerGateway } from '@/api/base44Client';

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
  const [isLoading, setIsLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
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
    const normalizedQuery = String(query || '').trim();
    if (normalizedQuery.length < 3) {
      setSuggestions([]);
      setOpen(false);
      setLookupError('');
      setIsLoading(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setLookupError('');
      try {
        const res = await invokeCustomerGateway('addressSuggest', { query: normalizedQuery });
        const data = res?.data || res;
        const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setOpen(list.length > 0);
        if (!list.length) setLookupError('No verified addresses found. Keep typing or check the address.');
      } catch {
        setSuggestions([]);
        setOpen(false);
        setLookupError('Address lookup is temporarily unavailable. You can still enter the full address below.');
      } finally {
        setIsLoading(false);
      }
    }, 350);
  };

  const handleStreetChange = (e) => {
    const nextStreet = e.target.value;
    // A changed street must not be combined with locality fields from a
    // previously selected address. Google selection (or deliberate manual
    // re-entry below) restores one internally consistent address.
    emit({ street: nextStreet, city: '', state: '', zip: '' });
    fetchSuggestions(nextStreet);
  };

  const handleSelect = (s) => {
    emit({ street: s.street, city: s.city, state: s.state, zip: s.zip });
    setSuggestions([]);
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Street */}
      <div className="relative">
        <Input
          name="streetAddress"
          aria-label="Street address"
          value={addr.street}
          onChange={handleStreetChange}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
            else fetchSuggestions(addr.street);
          }}
          placeholder={placeholder || '123 Main St'}
          className={className}
          autoComplete="address-line1"
        />
        {open && suggestions.length > 0 && (
          <ul aria-label="Google-verified address suggestions" className="absolute z-10 w-full mt-1 bg-card border border-border rounded-xl shadow-lg max-h-52 overflow-y-auto text-sm">
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

      <p className={`text-[11px] ${lookupError ? 'text-amber-700' : 'text-muted-foreground'}`} role="status">
        {isLoading ? 'Looking up verified addresses…' : lookupError || 'Start typing and select a Google-verified address.'}
      </p>

      {/* City / State / Zip */}
      <div className="grid grid-cols-5 gap-2">
        <div className="col-span-2">
          <Input
            name="city"
            aria-label="City"
            value={addr.city}
            onChange={e => emit({ ...addr, city: e.target.value })}
            placeholder="City"
            className={className}
            autoComplete="address-level2"
          />
        </div>
        <div className="col-span-1">
          <Input
            name="state"
            aria-label="State"
            value={addr.state}
            onChange={e => emit({ ...addr, state: e.target.value })}
            placeholder="ST"
            maxLength={2}
            className={className}
            autoComplete="address-level1"
          />
        </div>
        <div className="col-span-2">
          <Input
            name="postalCode"
            aria-label="ZIP code"
            value={addr.zip}
            onChange={e => emit({ ...addr, zip: e.target.value })}
            placeholder="ZIP"
            maxLength={10}
            className={className}
            autoComplete="postal-code"
          />
        </div>
      </div>
    </div>
  );
}
