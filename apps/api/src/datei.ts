/**
 * Serving stored files efficiently (decided 13.11.2026: many very large files – plans, 360° photos, PDFs).
 * Files are streamed from disk (never loaded into memory), with ETag/304 so devices don't load a file twice, and
 * byte ranges (206) so the PDF viewer can load large plans page by page and downloads can resume.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './mangel-service';

export interface Datei { pfad: string; type: string; name?: string }

export async function dateiSenden(req: FastifyRequest, reply: FastifyReply, d: Datei, opts: { maxAge?: number; download?: boolean } = {}) {
  let s: import('node:fs').Stats;
  try { s = await stat(d.pfad); } catch { throw new HttpError(404, 'Datei nicht gefunden'); }
  const etag = `W/"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
  reply.header('content-type', d.type).header('etag', etag).header('accept-ranges', 'bytes')
    .header('cache-control', `private, max-age=${opts.maxAge ?? 86400}`);
  if (d.name) reply.header('content-disposition', `${opts.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(d.name)}"`);
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : s.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : s.size - 1;
    start = Math.max(0, start); end = Math.min(end, s.size - 1);
    if (start > end) return reply.code(416).header('content-range', `bytes */${s.size}`).send();
    reply.code(206).header('content-range', `bytes ${start}-${end}/${s.size}`).header('content-length', end - start + 1);
    return reply.send(createReadStream(d.pfad, { start, end }));
  }
  reply.header('content-length', s.size);
  return reply.send(createReadStream(d.pfad));
}
