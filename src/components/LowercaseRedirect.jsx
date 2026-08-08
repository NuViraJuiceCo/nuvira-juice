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
    const segments = pathname.split('/');
    const routeRoot = segments[1]?.toLowerCase() || '';
    const preservesDynamicIdentifier = new Set([
      'shop',
      'product',
      'products',
      'program',
      'cart',
      'order-confirmation',
      'order-tracker',
    ]).has(routeRoot) && segments.length > 2;
    const canonicalPath = preservesDynamicIdentifier
      ? `/${routeRoot}/${segments.slice(2).join('/')}`
      : pathname.toLowerCase();
    if (canonicalPath !== pathname) {
      // Replace so back-button doesn't loop
      navigate(canonicalPath + search + hash, { replace: true });
    }
  }, [location.pathname]);

  return null;
}
