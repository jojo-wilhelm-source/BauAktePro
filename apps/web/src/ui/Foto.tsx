import { useEffect, useState } from 'react';
import { getToken } from '../api';

/** Photo from the API (auth header, so no token in the URL). Click opens it full size. */
export function Foto({ id, size = 96 }: { id: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void fetch(`/api/fotos/${id}/file`, { headers: { authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) setUrl((u = URL.createObjectURL(b)));
      });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="foto" style={{ width: size * 1.33, height: size }}>
      {url && <img src={url} alt="Foto zum Mangel" />}
    </a>
  );
}
