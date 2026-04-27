import { useState, useRef, useCallback } from 'react';

export function useToast() {
  const [toast, setToast] = useState({ visible: false, message: '', type: '' });
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = '') => {
    clearTimeout(timerRef.current);
    setToast({ visible: true, message, type });
    timerRef.current = setTimeout(
      () => setToast(t => ({ ...t, visible: false })),
      3000
    );
  }, []);

  return { toast, showToast };
}
