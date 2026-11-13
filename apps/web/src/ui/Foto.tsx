import { useApiBild } from './useApiBild';

/** Photo from the API (auth header, so no token in the URL). Click opens it full size. Shared image cache. */
export function Foto({ id, size = 96, src }: { id: string; size?: number; src?: string }) {
  // The id is part of the key (e.g. logo version), so a new upload is not served from the cache.
  const url = useApiBild(src ? `${src.replace(/^\/api/, '')}${src.includes('?') ? '&' : '?'}k=${encodeURIComponent(id)}` : `/fotos/${id}/file`);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="foto" style={{ width: size * 1.33, height: size }}>
      {url && <img src={url} alt="Foto" />}
    </a>
  );
}
