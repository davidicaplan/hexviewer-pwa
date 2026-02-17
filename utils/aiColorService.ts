import { getPrintConversions, hexToRgb, normalizeHex } from './colorUtils';
import { PrintConversion } from '../types';

export interface AiPrintResult extends PrintConversion {
  source: 'ai' | 'heuristic' | 'cache';
}

// Two-tier cache: in-memory + localStorage
const CACHE_KEY = 'hexviewer_ai_cmyk_cache';
const cache = new Map<string, AiPrintResult>();

function hydrateCache() {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const entries: [string, AiPrintResult][] = JSON.parse(stored);
      for (const [k, v] of entries) {
        cache.set(k, { ...v, source: 'cache' });
      }
    }
  } catch { /* ignore corrupt data */ }
}

function persistCache() {
  try {
    const entries = Array.from(cache.entries()).slice(-200);
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch { /* localStorage full */ }
}

hydrateCache();

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function heuristicFallback(hex: string): AiPrintResult {
  return { ...getPrintConversions(hex), source: 'heuristic' };
}

function buildPrompt(hexCodes: string[]): string {
  const hexList = hexCodes.map(h => `"${h}"`).join(', ');
  return `You are an expert print color technician specializing in offset and digital CMYK printing. For each hex color below, provide an optimized CMYK recipe for professional printing.

Hex codes: [${hexList}]

For EACH color provide:
1. Optimized C, M, Y, K values (integers 0-100) for vibrant print reproduction. Apply professional knowledge:
   - Rich black (C60/M40/Y40/K100) for pure black
   - Remove cyan from warm colors to prevent mudding/browning
   - Cap magenta for blues to prevent purple shift
   - Remove magenta from greens to keep them clean
   - Keep total ink coverage under 300%
   - Account for CMYK gamut being smaller than RGB
2. A 1-2 sentence explanation of your modifications for a designer audience
3. Recommended paper type

Respond with ONLY a JSON array, no markdown, no extra text. Each element:
{"hex":"#XXXXXX","c":0,"m":0,"y":0,"k":0,"explanation":"...","paper":"..."}`;
}

function parseAiResponse(text: string, requestedHexes: string[]): Map<string, AiPrintResult> {
  const results = new Map<string, AiPrintResult>();

  try {
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed: Array<{ hex: string; c: number; m: number; y: number; k: number; explanation: string; paper: string }> = JSON.parse(cleaned);

    for (const item of parsed) {
      const normalized = normalizeHex(item.hex);
      const { r, g, b } = hexToRgb(normalized);

      // Compute standard auto CMYK
      const rP = r / 255, gP = g / 255, bP = b / 255;
      const kStd = 1 - Math.max(rP, gP, bP);
      const cStd = kStd === 1 ? 0 : Math.round(((1 - rP - kStd) / (1 - kStd)) * 100);
      const mStd = kStd === 1 ? 0 : Math.round(((1 - gP - kStd) / (1 - kStd)) * 100);
      const yStd = kStd === 1 ? 0 : Math.round(((1 - bP - kStd) / (1 - kStd)) * 100);

      results.set(normalized, {
        input_hex: normalized,
        conversions: {
          standard_auto: {
            c: cStd, m: mStd, y: yStd, k: Math.round(kStd * 100),
            description: 'Standard mathematical conversion. May appear duller on paper.'
          },
          smart_print_recipe: {
            c: clamp(item.c),
            m: clamp(item.m),
            y: clamp(item.y),
            k: clamp(item.k),
            modifications_made: item.explanation,
            paper_type: item.paper || 'Regular Stock',
          }
        },
        source: 'ai',
      });
    }
  } catch (err) {
    console.warn('Failed to parse AI response:', err);
    for (const hex of requestedHexes) {
      if (!results.has(hex)) {
        results.set(hex, heuristicFallback(hex));
      }
    }
  }

  return results;
}

export async function fetchAiCmykBatch(hexCodes: string[]): Promise<Map<string, AiPrintResult>> {
  const results = new Map<string, AiPrintResult>();
  const uncached: string[] = [];

  for (const hex of hexCodes) {
    const normalized = normalizeHex(hex);
    const cached = cache.get(normalized);
    if (cached) {
      results.set(normalized, cached);
    } else {
      uncached.push(normalized);
    }
  }

  if (uncached.length === 0) return results;

  const apiKey = (process.env as any).GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    for (const hex of uncached) {
      const fb = heuristicFallback(hex);
      results.set(hex, fb);
      cache.set(hex, fb);
    }
    persistCache();
    return results;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(uncached) }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!response.ok) throw new Error(`Gemini API ${response.status}`);

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseAiResponse(text, uncached);

    for (const [hex, result] of parsed) {
      results.set(hex, result);
      cache.set(hex, result);
    }
    persistCache();
  } catch (err) {
    console.warn('AI CMYK fetch failed, falling back to heuristic:', err);
    for (const hex of uncached) {
      const fb = heuristicFallback(hex);
      results.set(hex, fb);
    }
  }

  return results;
}

export function getCachedResult(hex: string): AiPrintResult | undefined {
  return cache.get(normalizeHex(hex));
}
