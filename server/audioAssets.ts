/** Workers Static Assets return whole files for Range requests. Serve audio ranges here. */
export async function serveAudioAsset(request: Request, assets: { fetch(request: Request): Promise<Response> }): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.delete('Range');
  upstreamHeaders.delete('If-Range');
  upstreamHeaders.set('Accept-Encoding', 'identity');
  const source = await assets.fetch(new Request(request, { headers: upstreamHeaders }));
  if (source.status !== 200) return source;
  // A missing asset must not turn the SPA fallback into an apparent audio file.
  if (!source.headers.get('Content-Type')?.toLowerCase().startsWith('audio/')) {
    await source.body?.cancel();
    return new Response('Audio not found', { status: 404 });
  }
  const headers = new Headers(source.headers);
  headers.set('Accept-Ranges', 'bytes');
  const raw = request.headers.get('Range');
  const range = raw?.trim().match(/^bytes=(\d*)-(\d*)$/);
  const validator = request.headers.get('If-Range');
  const etag = headers.get('ETag'), modified = headers.get('Last-Modified');
  const matches = !validator || !validator.startsWith('W/') && (validator === etag || !!modified && Number.isFinite(Date.parse(validator)) && Date.parse(validator) >= Date.parse(modified));
  if (!range || !matches || !range[1] && !range[2]) return new Response(source.body, { status: 200, headers });
  const first = range[1] ? Number(range[1]) : undefined, last = range[2] ? Number(range[2]) : undefined;
  if (first !== undefined && !Number.isSafeInteger(first) || last !== undefined && !Number.isSafeInteger(last)) return new Response(source.body, { status: 200, headers });
  const bytes = request.method === 'HEAD' ? null : await source.arrayBuffer();
  const size = bytes?.byteLength ?? Number(headers.get('Content-Length'));
  if (!Number.isSafeInteger(size) || size < 0) return new Response(null, { status: 502 });
  const start = first ?? Math.max(0, size - last!), end = first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);
  headers.delete('Content-Encoding');
  headers.delete('Transfer-Encoding');
  if (size === 0 || start >= size || end < start || first === undefined && last === 0) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes?.slice(start, end + 1) ?? null, { status: 206, headers });
}
