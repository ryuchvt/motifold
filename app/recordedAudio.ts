import { useEffect, useState } from 'react';
import { loadDemoCatalog, localDemoAsset, type DemoOutcome, type DemoPiece } from './demo';

export const audioDigest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');

/** Reference audio is used only when its manifest names the actual source MIDI. */
export function originalAudioFor(value: unknown, pieceId: string, midiHash: string): string | undefined {
  if (!value || typeof value !== 'object') return;
  const item = (value as Record<string, unknown>)[pieceId];
  if (!item || typeof item !== 'object') return;
  const row = item as Record<string, unknown>;
  return row.midiSha256 === midiHash && localDemoAsset(row.url) ? row.url : undefined;
}

export async function loadOriginalAudio(pieceId: string, bytes: Uint8Array, signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch('/demo/original-audio.json', { signal });
    return response.ok ? originalAudioFor(await response.json(), pieceId, await audioDigest(bytes)) : undefined;
  } catch { return undefined; }
}

/** Edited, partial and differently selected scores cannot inherit another result's audio. */
export function useRecordedOutcome(piece: Pick<DemoPiece, 'id' | 'catalog'> | undefined, xml: string | null): DemoOutcome | undefined {
  const [match, setMatch] = useState<{ xml: string; pieceId: string; catalog: string | undefined; outcome: DemoOutcome }>();
  useEffect(() => {
    let active = true;
    if (piece && xml) void (async () => {
      const [catalog, hash] = await Promise.all([loadDemoCatalog(piece), audioDigest(new TextEncoder().encode(xml))]);
      const outcome = catalog?.outcomes.find(row => row.status === 'complete' && row.render && row.renderXmlSha256 === hash && row.xmlSha256 === hash);
      if (active) setMatch(outcome ? { xml, pieceId: piece.id, catalog: piece.catalog, outcome } : undefined);
    })().catch(() => { if (active) setMatch(undefined); });
    return () => { active = false; };
  }, [piece?.id, piece?.catalog, xml]);
  return piece && match?.xml === xml && match.pieceId === piece.id && match.catalog === piece.catalog ? match.outcome : undefined;
}

export function outcomeAudio(outcome: DemoOutcome | undefined, solo: string[]): string | string[] | undefined {
  if (!outcome?.render) return;
  if (!solo.length) return outcome.render;
  const urls = solo.map(label => outcome.renderStems?.find(stem => stem.label === label)?.url);
  return urls.every((url): url is string => !!url) ? urls : undefined;
}
