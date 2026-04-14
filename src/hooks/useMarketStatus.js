import { useState, useEffect } from 'react';

function getMarketStatus() {
  const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day  = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const wd   = day >= 1 && day <= 5;
  const open = wd && mins >= 570 && mins < 960;
  let text;
  if (open) {
    const c = 960 - mins;
    text = `Open · ${Math.floor(c / 60)}h ${c % 60}m`;
  } else {
    text = wd ? 'Market closed' : 'Weekend';
  }
  return { isOpen: open, text };
}

export function useMarketStatus() {
  const [status, setStatus] = useState(getMarketStatus);

  useEffect(() => {
    const id = setInterval(() => setStatus(getMarketStatus()), 30000);
    return () => clearInterval(id);
  }, []);

  return { isOpen: status.isOpen, marketText: status.text };
}
