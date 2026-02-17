
export interface ColorRecord {
  id: string;
  hex: string;
}

export interface Collection {
  id: string;
  name: string;
  colors: ColorRecord[];
  selectedIds: string[];
}

export enum ContrastType {
  LIGHT = 'LIGHT',
  DARK = 'DARK'
}

export interface CmykValues {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface PrintConversion {
  input_hex: string;
  conversions: {
    standard_auto: CmykValues & { description: string };
    smart_print_recipe: CmykValues & { 
      modifications_made: string;
      paper_type: string;
    };
  };
}
