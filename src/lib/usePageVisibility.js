import { useEffect, useState } from 'react';

function readPageVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

export function usePageVisibility() {
  const [isPageVisible, setIsPageVisible] = useState(readPageVisible);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const syncVisibility = () => {
      setIsPageVisible(readPageVisible());
    };

    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('focus', syncVisibility);
    window.addEventListener('blur', syncVisibility);
    syncVisibility();

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('focus', syncVisibility);
      window.removeEventListener('blur', syncVisibility);
    };
  }, []);

  return isPageVisible;
}
