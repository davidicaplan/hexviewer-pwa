
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { isValidHex, normalizeHex, copyToClipboard, hexToRgbString } from './utils/colorUtils';
import { useAiCmyk } from './hooks/useAiCmyk';
import { ColorRecord, Collection } from './types';

const STORAGE_KEY_COLLECTIONS = 'hexviewer_collections_v2';
const STORAGE_KEY_ACTIVE_ID = 'hexviewer_active_id';

const DEFAULT_COLLECTIONS: Collection[] = [
  {
    id: 'default-1',
    name: 'Brand Palette',
    colors: [
      { id: '1', hex: '#6366F1' },
      { id: '2', hex: '#F43F5E' },
      { id: '3', hex: '#10B981' },
      { id: '4', hex: '#F59E0B' }
    ],
    selectedIds: ['1', '2']
  }
];

const loadCollections = (): Collection[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COLLECTIONS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn('Failed to load collections from localStorage:', e);
  }
  return DEFAULT_COLLECTIONS;
};

const saveCollections = (collections: Collection[]) => {
  try {
    localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(collections));
  } catch (e) {
    console.warn('Failed to save collections to localStorage:', e);
  }
};

const saveActiveId = (id: string) => {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_ID, id);
  } catch (e) {
    console.warn('Failed to save active ID to localStorage:', e);
  }
};

const App: React.FC = () => {
  const [collections, setCollections] = useState<Collection[]>(loadCollections);

  const [activeCollectionId, setActiveCollectionId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
      const cols = loadCollections();
      return saved && cols.some(c => c.id === saved) ? saved : cols[0]?.id || '';
    } catch {
      return collections[0]?.id || '';
    }
  });

  const [inputValue, setInputValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const newColInputRef = useRef<HTMLInputElement>(null);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingColName, setEditingColName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Refs to track latest state for event handlers
  const collectionsRef = useRef(collections);
  const activeIdRef = useRef(activeCollectionId);
  collectionsRef.current = collections;
  activeIdRef.current = activeCollectionId;

  // Persist collections on every change
  useEffect(() => {
    saveCollections(collections);
  }, [collections]);

  useEffect(() => {
    saveActiveId(activeCollectionId);
  }, [activeCollectionId]);

  // Save on page hide (critical for mobile PWAs where beforeunload may not fire)
  useEffect(() => {
    const persistState = () => {
      saveCollections(collectionsRef.current);
      saveActiveId(activeIdRef.current);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistState();
      }
    };

    const handleBeforeUnload = () => {
      persistState();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, []);

  const activeCollection = useMemo(() => {
    return collections.find(c => c.id === activeCollectionId) || collections[0];
  }, [collections, activeCollectionId]);

  const selectedColors = useMemo(() => {
    if (!activeCollection) return [];
    return activeCollection.colors
      .filter(item => activeCollection.selectedIds.includes(item.id));
  }, [activeCollection]);

  const { getResult: getAiPrintData, isLoading: isAiLoading } = useAiCmyk(activeCollection?.colors || []);

  const handleCreateCollection = () => {
    if (!newCollectionName.trim()) return;
    const newId = Math.random().toString(36).substring(7);
    const newCol: Collection = {
      id: newId,
      name: newCollectionName.trim(),
      colors: [],
      selectedIds: []
    };
    setCollections(prev => [...prev, newCol]);
    setActiveCollectionId(newId);
    setNewCollectionName('');
    setIsCreating(false);
  };

  const handleAddColors = () => {
    const lines = inputValue.split('\n')
      .map(line => line.trim())
      .filter(line => line !== '' && isValidHex(line));

    if (lines.length > 0 && activeCollection) {
      const newRecords: ColorRecord[] = lines.map(line => ({
        id: Math.random().toString(36).substring(7),
        hex: normalizeHex(line)
      }));

      setCollections(prev => prev.map(c => {
        if (c.id !== activeCollectionId) return c;
        const updatedColors = [...newRecords, ...c.colors];
        let updatedSelected = [...c.selectedIds];
        for (const record of newRecords) {
          if (updatedSelected.length < 12) updatedSelected.push(record.id);
        }
        return { ...c, colors: updatedColors, selectedIds: updatedSelected };
      }));
      setInputValue('');
    }
  };

  const toggleSelection = (colorId: string) => {
    setCollections(prev => prev.map(c => {
      if (c.id !== activeCollectionId) return c;
      const isSelected = c.selectedIds.includes(colorId);
      if (isSelected) {
        return { ...c, selectedIds: c.selectedIds.filter(id => id !== colorId) };
      }
      if (c.selectedIds.length >= 12) return c;
      return { ...c, selectedIds: [...c.selectedIds, colorId] };
    }));
  };

  const removeColor = (e: React.MouseEvent, colorId: string) => {
    e.stopPropagation();
    setCollections(prev => prev.map(c => {
      if (c.id !== activeCollectionId) return c;
      return {
        ...c,
        colors: c.colors.filter(col => col.id !== colorId),
        selectedIds: c.selectedIds.filter(id => id !== colorId)
      };
    }));
  };

  const deleteCollection = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (collections.length <= 1) return;
    const col = collections.find(c => c.id === id);
    if (!confirm(`Delete "${col?.name}"? This cannot be undone.`)) return;
    const remaining = collections.filter(c => c.id !== id);
    setCollections(remaining);
    if (activeCollectionId === id) {
      setActiveCollectionId(remaining[0].id);
    }
  };

  const renameCollection = () => {
    if (!editingColId || !editingColName.trim()) {
      setEditingColId(null);
      return;
    }
    setCollections(prev => prev.map(c =>
      c.id === editingColId ? { ...c, name: editingColName.trim() } : c
    ));
    setEditingColId(null);
  };

  const handleDrop = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    setCollections(prev => prev.map(c => {
      if (c.id !== activeCollectionId) return c;
      const colors = [...c.colors];
      const fromIndex = colors.findIndex(col => col.id === sourceId);
      const toIndex = colors.findIndex(col => col.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return c;
      const [moved] = colors.splice(fromIndex, 1);
      colors.splice(toIndex, 0, moved);
      return { ...c, colors };
    }));
    setDragId(null);
    setDragOverId(null);
  };

  const handleCopy = async (text: string, id: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const exportToPdf = () => {
    if (selectedColors.length === 0 || !activeCollection) return;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297;
    const pageH = 210;
    const cols = 3;
    const rows = Math.ceil(selectedColors.length / cols);
    const cellW = pageW / cols;
    const cellH = pageH / rows;

    selectedColors.forEach((color, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cellW;
      const y = row * cellH;

      // Parse hex to RGB for fill
      const r = parseInt(color.hex.slice(1, 3), 16);
      const g = parseInt(color.hex.slice(3, 5), 16);
      const b = parseInt(color.hex.slice(5, 7), 16);

      pdf.setFillColor(r, g, b);
      pdf.rect(x, y, cellW, cellH, 'F');

      // White text
      pdf.setTextColor(255, 255, 255);
      const cx = x + cellW / 2;
      let ty = y + cellH * 0.2;
      const lineGap = cellH * 0.1;

      // Hex
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text(color.hex.toUpperCase(), cx, ty, { align: 'center' });
      ty += lineGap;

      pdf.setFontSize(10);
      // RGB
      const rgbStr = hexToRgbString(color.hex);
      pdf.text(rgbStr, cx, ty, { align: 'center' });
      ty += lineGap;

      // CMYK
      const printData = getAiPrintData(color.hex);
      const auto = printData.conversions.standard_auto;
      const smart = printData.conversions.smart_print_recipe;

      pdf.text(`CMYK Auto: ${auto.c}, ${auto.m}, ${auto.y}, ${auto.k}`, cx, ty, { align: 'center' });
      ty += lineGap;

      pdf.text(`Smart: ${smart.c}, ${smart.m}, ${smart.y}, ${smart.k}`, cx, ty, { align: 'center' });
      ty += lineGap;

      // Insight (wrap to fit cell)
      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'normal');
      const insight = smart.modifications_made;
      const lines = pdf.splitTextToSize(insight, cellW - 10);
      pdf.text(lines, cx, ty, { align: 'center' });
    });

    pdf.save(`${activeCollection.name}-palette.pdf`);
  };

  const handleExportPalettes = () => {
    const data = JSON.stringify(collections, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hexviewer-palettes.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPalettes = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id && parsed[0].name && parsed[0].colors) {
            setCollections(parsed);
            setActiveCollectionId(parsed[0].id);
          } else {
            alert('Invalid palette file format.');
          }
        } catch {
          alert('Could not read file. Make sure it is a valid palette JSON.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const hasValidInput = useMemo(() => {
    return inputValue.split('\n').some(line => isValidHex(line.trim()));
  }, [inputValue]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-white selection:bg-indigo-500/30">
      
      {/* 1. Palette Preview Area (Hero) */}
      <section className="w-full shadow-2xl relative border-b border-white/5 shrink-0">
        {isAiLoading && selectedColors.length > 0 && (
          <div className="absolute top-3 right-4 z-50 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full">
            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-300">AI analyzing...</span>
          </div>
        )}
        {selectedColors.length > 0 ? (
          <div className="grid grid-cols-3">
          {selectedColors.map((color) => {
            const rgbValue = hexToRgbString(color.hex);
            const printData = getAiPrintData(color.hex);
            const smart = printData.conversions.smart_print_recipe;
            const auto = printData.conversions.standard_auto;
            const source = (printData as any).source;

            return (
              <div
                key={color.id}
                className="flex flex-col items-center justify-center transition-all duration-500 ease-in-out py-8 px-4 text-center group relative text-white"
                style={{ backgroundColor: color.hex }}
              >
                <span className="font-mono font-black text-2xl md:text-4xl drop-shadow-sm tracking-tight">
                  {color.hex}
                </span>

                <div className="mt-4 font-mono text-sm md:text-base font-bold">
                  {rgbValue}
                </div>

                <div className="mt-2 font-mono text-sm md:text-base font-bold">
                  CMYK Auto: {auto.c}, {auto.m}, {auto.y}, {auto.k}
                </div>

                <div className="mt-1 font-mono text-sm md:text-base font-bold">
                  Smart: {smart.c}, {smart.m}, {smart.y}, {smart.k}
                </div>

                <p className="mt-4 text-xs md:text-sm font-bold leading-snug max-w-[220px]">
                  {smart.modifications_made}
                </p>

                {source === 'ai' && (
                  <span className="mt-2 text-[8px] font-bold text-white/50 uppercase tracking-widest">AI-optimized</span>
                )}

                <div className="absolute bottom-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleCopy(color.hex, `hex-${color.id}`)} className="p-2 bg-black/10 rounded-lg hover:bg-black/20 transition-colors">
                    {copiedId === `hex-${color.id}` ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleCopy(`${smart.c},${smart.m},${smart.y},${smart.k}`, `cmyk-${color.id}`)} className="p-2 bg-black/10 rounded-lg hover:bg-black/20 transition-colors" title="Copy Smart CMYK">
                    {copiedId === `cmyk-${color.id}` ? <CheckIcon className="w-4 h-4" /> : <PrintIcon className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
          </div>
        ) : (
          <div className="w-full py-20 flex items-center justify-center bg-gray-900 text-gray-700 font-bold uppercase tracking-[0.3em] text-sm">
            {activeCollection?.colors.length ? 'Select colors below' : 'Add colors to start'}
          </div>
        )}

      </section>

      <div className="w-full flex justify-center items-center gap-3 py-3 bg-gray-950 border-b border-white/5 flex-wrap">
        <span className="bg-white/5 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase border border-white/10">
          {activeCollection?.name} • {selectedColors.length} / 12 Selected
        </span>
        {selectedColors.length > 0 && (
          <button
            onClick={exportToPdf}
            disabled={isAiLoading}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/10 disabled:text-gray-500 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase transition-all active:scale-95"
          >
            <DownloadIcon className="w-3.5 h-3.5" />
            Export PDF
          </button>
        )}
        <button
          onClick={handleExportPalettes}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase transition-all active:scale-95"
        >
          <SaveIcon className="w-3.5 h-3.5" />
          Save Palettes
        </button>
        <button
          onClick={handleImportPalettes}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase transition-all active:scale-95 border border-white/10"
        >
          <UploadIcon className="w-3.5 h-3.5" />
          Load Palettes
        </button>
      </div>

      {/* 2. Collections Tabs (Sticky) */}
      <nav className="sticky top-0 z-40 bg-gray-950/80 backdrop-blur-xl border-b border-white/5 px-6 overflow-x-auto no-scrollbar flex items-center gap-2 py-4 shadow-xl">
        {collections.map(col => (
          <div
            key={col.id}
            className={`group flex items-center gap-2 px-4 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCollectionId === col.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white/5 text-gray-500 hover:bg-white/10'
            }`}
            onClick={() => setActiveCollectionId(col.id)}
          >
            {editingColId === col.id ? (
              <input
                autoFocus
                className="bg-transparent border-b border-white/40 text-[10px] font-black uppercase tracking-wider focus:outline-none w-24"
                value={editingColName}
                onChange={(e) => setEditingColName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && renameCollection()}
                onBlur={() => renameCollection()}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="text-[10px] font-black uppercase tracking-wider"
                onDoubleClick={(e) => { e.stopPropagation(); setEditingColId(col.id); setEditingColName(col.name); }}
              >
                {col.name}
              </span>
            )}
            {collections.length > 1 && (
              <button
                onClick={(e) => deleteCollection(e, col.id)}
                className={`transition-opacity ${activeCollectionId === col.id ? 'opacity-50 hover:opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        
        {isCreating ? (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
            <input 
              ref={newColInputRef}
              autoFocus
              className="bg-white/10 border border-white/10 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider focus:outline-none focus:ring-2 ring-indigo-500/50 w-32"
              placeholder="Name..."
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
              onBlur={() => !newCollectionName && setIsCreating(false)}
            />
            <button onClick={handleCreateCollection} className="p-1.5 bg-indigo-600 rounded-lg"><CheckIcon className="w-3 h-3" /></button>
          </div>
        ) : (
          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 text-gray-500 hover:bg-white/10 border border-dashed border-white/20 transition-all"
          >
            <PlusIcon className="w-3 h-3" />
            <span className="text-[10px] font-black uppercase tracking-wider">New Set</span>
          </button>
        )}
      </nav>

      {/* 3. Main Content Area */}
      <main className="flex-1 p-6 safe-bottom">
        <div className="max-w-2xl mx-auto space-y-12 pb-32">
          
          {/* Importer Section */}
          <div className="bg-white/[0.03] rounded-[2.5rem] p-8 border border-white/10 shadow-2xl relative overflow-hidden group">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-400">
                Add to {activeCollection?.name}
              </h2>
              <span className="text-[9px] text-gray-600 font-bold uppercase tracking-widest">Multi-line support</span>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="relative group">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className={`w-full bg-white/[0.05] border-2 rounded-3xl py-4 px-6 font-mono font-bold focus:outline-none transition-all resize-none h-36 scrollbar-hide no-scrollbar ${
                    hasValidInput || inputValue === '' ? 'border-white/5 focus:border-indigo-500/50' : 'border-red-500/30'
                  }`}
                  placeholder="#6366F1&#10;#F43F5E&#10;#10B981"
                />
                <div className="absolute top-4 right-6 text-[9px] text-gray-700 font-black uppercase tracking-widest pointer-events-none group-focus-within:opacity-0 transition-opacity">
                  Paste Hex Codes
                </div>
              </div>
              <button
                onClick={handleAddColors}
                disabled={!hasValidInput}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-gray-700 py-5 rounded-3xl font-black text-sm tracking-widest uppercase transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-xl shadow-indigo-900/10"
              >
                <PlusIcon className="w-5 h-5" />
                Add to Current Set
              </button>
            </div>
          </div>

          {/* Library Section */}
          <div>
            <div className="flex justify-between items-end mb-6 px-4">
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">{activeCollection?.name} Library</h2>
              <span className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">
                {activeCollection?.colors.length || 0} Total
              </span>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              {activeCollection?.colors.map((item) => {
                const isSelected = activeCollection.selectedIds.includes(item.id);
                const printData = getAiPrintData(item.hex);
                const smart = printData.conversions.smart_print_recipe;

                return (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.id); setDragId(item.id); }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverId(item.id); }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={(e) => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), item.id); }}
                    onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                    onClick={() => toggleSelection(item.id)}
                    className={`group relative aspect-square rounded-[2rem] cursor-grab active:cursor-grabbing transition-all duration-500 overflow-hidden ring-offset-8 ring-offset-gray-950 ${
                      isSelected ? 'ring-2 ring-indigo-500 scale-[0.96] shadow-2xl shadow-indigo-500/20' : 'hover:scale-[1.03]'
                    } ${dragOverId === item.id && dragId !== item.id ? 'ring-2 ring-indigo-400 scale-[1.05]' : ''} ${dragId === item.id ? 'opacity-40' : ''}`}
                  >
                    <div className="absolute inset-0" style={{ backgroundColor: item.hex }} />
                    
                    {isSelected && (
                      <div className="absolute top-4 right-4 bg-indigo-500 text-white p-1 rounded-full shadow-2xl z-20 scale-110">
                        <CheckIcon className="w-4 h-4" />
                      </div>
                    )}

                    <button
                      onClick={(e) => removeColor(e, item.id)}
                      className="absolute top-4 left-4 bg-black/20 hover:bg-red-500 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all backdrop-blur-md z-20"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>

                    <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-md p-4 flex flex-col transform translate-y-1 group-hover:translate-y-0 transition-transform">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] font-mono font-black tracking-tight">{item.hex}</span>
                        <div className="flex gap-2">
                          <button onClick={(e) => { e.stopPropagation(); handleCopy(item.hex, `lib-${item.id}`); }}>
                            {copiedId === `lib-${item.id}` ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[8px] font-bold text-indigo-400">CMYK: {smart.c},{smart.m},{smart.y},{smart.k}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {!activeCollection?.colors.length && (
                <div className="col-span-full py-20 text-center text-gray-800 border-2 border-dashed border-white/5 rounded-[3rem]">
                  <p className="font-black text-xs uppercase tracking-widest">No colors here yet</p>
                  <p className="text-[10px] mt-2 font-bold opacity-40">Add codes above to populate this set</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// SVG Icons
const PrintIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
);
const PlusIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
);
const CopyIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
);
const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
);
const XIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
);
const DownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
);
const SaveIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
);
const UploadIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
);

export default App;
