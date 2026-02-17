import { useState, useEffect, useCallback } from 'react';
import { fetchAiCmykBatch, AiPrintResult, getCachedResult } from '../utils/aiColorService';
import { getPrintConversions } from '../utils/colorUtils';
import { ColorRecord, PrintConversion } from '../types';

interface UseAiCmykReturn {
  getResult: (hex: string) => PrintConversion & { source?: string };
  isLoading: boolean;
}

export function useAiCmyk(colors: ColorRecord[]): UseAiCmykReturn {
  const [aiResults, setAiResults] = useState<Map<string, AiPrintResult>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const hexKey = colors.map(c => c.hex).join(',');

  useEffect(() => {
    if (colors.length === 0) return;

    let cancelled = false;
    setIsLoading(true);

    fetchAiCmykBatch(colors.map(c => c.hex)).then(results => {
      if (!cancelled) {
        setAiResults(prev => {
          const next = new Map(prev);
          for (const [k, v] of results) next.set(k, v);
          return next;
        });
        setIsLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [hexKey]);

  const getResult = useCallback((hex: string): PrintConversion & { source?: string } => {
    const normalized = hex.toUpperCase().startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
    const aiResult = aiResults.get(normalized);
    if (aiResult) return aiResult;
    // Check if cache has it (from localStorage hydration)
    const cached = getCachedResult(hex);
    if (cached) return cached;
    // Synchronous fallback
    return { ...getPrintConversions(hex), source: 'heuristic' };
  }, [aiResults]);

  return { getResult, isLoading };
}
