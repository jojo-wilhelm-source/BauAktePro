/**
 * Images from the API with the auth header (no token in URLs). One shared cache per page view: the same photo in the
 * gallery, the series strip and the start page is loaded once; object URLs are released when no longer used.
 */
import { useEffect, useState } from 'react';
import { getToken } from '../api';

const cache = new Map<string, { url: Promise<string | null>; nutzer: number; fertig?: string | null }>();

export function useApiBild(pfad: string | null) {
  const [url, setUrl] = useState<string | null>(() => (pfad ? cache.get(pfad)?.fertig ?? null : null));
  useEffect(() => {
    if (!pfad) { setUrl(null); return; }
    let e = cache.get(pfad);
    if (!e) {
      const neu: { url: Promise<string | null>; nutzer: number; fertig?: string | null } = { nutzer: 0, url: Promise.resolve(null) };
      neu.url = fetch(`/api${pfad}`, { headers: { authorization: `Bearer ${getToken()}` } })
        .then((r) => (r.ok ? r.blob() : null)).then((b) => (neu.fertig = b ? URL.createObjectURL(b) : null)).catch(() => null);
      cache.set(pfad, (e = neu));
    }
    e.nutzer++;
    let aktiv = true;
    void e.url.then((u) => aktiv && setUrl(u));
    const eintrag = e;
    return () => {
      aktiv = false;
      // Keep recently used images briefly (scrolling back), then free the memory.
      setTimeout(() => { if (--eintrag.nutzer <= 0 && cache.get(pfad) === eintrag) { if (eintrag.fertig) URL.revokeObjectURL(eintrag.fertig); cache.delete(pfad); } }, 30_000);
    };
  }, [pfad]);
  return url;
}
