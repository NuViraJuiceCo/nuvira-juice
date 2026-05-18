/**
 * LowercaseRedirect — enforces lowercase URLs.
 * If the current pathname contains any uppercase letters,
 * it silently replaces the URL with the lowercase equivalent.
 * This prevents duplicate-content issues in Google Search Console.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function LowercaseRedirect() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const { pathname, search, hash } = location;
    const lower = pathname.toLowerCase();
    if (lower !== pathname) {
      // Replace so back-button doesn't loop
      navigate(lower + search + hash, { replace: true });
    }
  }, [location.pathname]);

  return null;
}