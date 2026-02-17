
import { ContrastType, PrintConversion, CmykValues } from '../types';

export const isValidHex = (hex: string): boolean => {
  return /^#?([0-9A-Fa-f]{3}){1,2}$/i.test(hex);
};

export const normalizeHex = (hex: string): string => {
  let cleaned = hex.startsWith('#') ? hex : `#${hex}`;
  if (!isValidHex(cleaned)) return '#FFFFFF';
  return cleaned.toUpperCase();
};

export const hexToRgb = (hex: string) => {
  let color = hex.replace('#', '');
  if (color.length === 3) {
    color = color.split('').map(char => char + char).join('');
  }
  return {
    r: parseInt(color.substring(0, 2), 16),
    g: parseInt(color.substring(2, 4), 16),
    b: parseInt(color.substring(4, 6), 16)
  };
};

export const hexToRgbString = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
};

const getHue = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return h * 360;
};

export const getPrintConversions = (hex: string): PrintConversion => {
  const normalized = normalizeHex(hex);
  const { r, g, b } = hexToRgb(normalized);
  
  // Standard Math Conversion
  const rPrime = r / 255;
  const gPrime = g / 255;
  const bPrime = b / 255;
  const kStd = 1 - Math.max(rPrime, gPrime, bPrime);
  const cStd = kStd === 1 ? 0 : Math.round(((1 - rPrime - kStd) / (1 - kStd)) * 100);
  const mStd = kStd === 1 ? 0 : Math.round(((1 - gPrime - kStd) / (1 - kStd)) * 100);
  const yStd = kStd === 1 ? 0 : Math.round(((1 - bPrime - kStd) / (1 - kStd)) * 100);
  const kFinalStd = Math.round(kStd * 100);

  // Heuristic Smart Recipe
  let cSmart = cStd, mSmart = mStd, ySmart = yStd, kSmart = kFinalStd;
  let mods = "Standard conversion applied.";
  const hue = getHue(r, g, b);

  // 1. Rich Black Rule
  if (normalized === '#000000') {
    cSmart = 60; mSmart = 40; ySmart = 40; kSmart = 100;
    mods = "Rich Black mix applied for deeper, professional coverage.";
  } 
  // 2. Anti-Mud Rule (Orange/Yellow/Red)
  else if ((hue >= 0 && hue <= 50) || (hue >= 330 && hue <= 360)) {
    cSmart = 0;
    kSmart = 0;
    // Boost vibrancy as seen in tech specs
    mSmart = Math.min(100, Math.round(mStd * 1.2));
    ySmart = Math.min(100, Math.round(yStd * 1.15));
    mods = "Removed Cyan/Black to prevent browning; boosted vibrancy for print.";
  }
  // 3. Anti-Purple Rule (Vibrant Blue)
  else if (hue >= 190 && hue <= 260) {
    cSmart = 100;
    mSmart = Math.min(70, mStd);
    kSmart = Math.max(5, Math.min(15, kFinalStd + 5));
    mods = "Capped Magenta to prevent purple shift; boosted Cyan and added depth Black.";
  }
  // 4. Clean Green Rule
  else if (hue >= 70 && hue <= 165) {
    mSmart = 0;
    kSmart = 0;
    cSmart = Math.round(cStd * 0.9);
    ySmart = 100;
    mods = "Removed Magenta/Black to prevent mudding; relied on heavy Cyan/Yellow mix.";
  }

  return {
    input_hex: normalized,
    conversions: {
      standard_auto: {
        c: cStd, m: mStd, y: yStd, k: kFinalStd,
        description: "Standard mathematical conversion. May appear duller on paper."
      },
      smart_print_recipe: {
        c: cSmart, m: mSmart, y: ySmart, k: kSmart,
        modifications_made: mods,
        paper_type: "Regular Stock"
      }
    }
  };
};

export const getContrastType = (hex: string): ContrastType => {
  if (!isValidHex(hex)) return ContrastType.DARK;
  const { r, g, b } = hexToRgb(hex);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? ContrastType.DARK : ContrastType.LIGHT;
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy!', err);
    return false;
  }
};
