import React, { useEffect, useRef } from 'react';

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

  // Set initial value once
  useEffect(() => {
    if (inputRef.current && value) {
      inputRef.current.value = value;
    }
  }, []);

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
        inputRef.current.value = formatted;
        onChange(formatted);
      });
    });
  }, []);

  return (
    <input
      ref={inputRef}
      defaultValue={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || '123 Main St, City, State'}
      className={`flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm ${className || ''}`}
      autoComplete="off"
    />
  );
}