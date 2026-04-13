import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

const GOOGLE_MAPS_API_KEY = 'AIzaSyCj2tE8wuBqsvM42qrGTheceZyqPJpJpng';

let scriptLoaded = false;
let scriptLoading = false;
const callbacks = [];

function loadGoogleMaps(callback) {
  if (scriptLoaded) { callback(); return; }
  callbacks.push(callback);
  if (scriptLoading) return;
  scriptLoading = true;
  window.__googleMapsLoaded = () => {
    scriptLoaded = true;
    callbacks.forEach(cb => cb());
  };
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&callback=__googleMapsLoaded`;
  script.async = true;
  document.head.appendChild(script);
}

export default function AddressAutocomplete({ value, onChange, placeholder, className }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [inputValue, setInputValue] = useState(value || '');

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  useEffect(() => {
    loadGoogleMaps(() => {
      if (!inputRef.current || autocompleteRef.current) return;
      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
      });
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        const formatted = place.formatted_address || inputRef.current.value;
        setInputValue(formatted);
        onChange(formatted);
      });
    });
  }, []);

  return (
    <Input
      ref={inputRef}
      value={inputValue}
      onChange={e => {
        setInputValue(e.target.value);
        onChange(e.target.value);
      }}
      placeholder={placeholder || '123 Main St, City, State'}
      className={className}
      autoComplete="off"
    />
  );
}