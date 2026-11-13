import { describe, expect, it } from 'vitest';
import { ist360 } from './fotodoku';

describe('Fotodoku', () => {
  it('erkennt 360°-Fotos am Seitenverhältnis 2:1 oder an XMP', () => {
    expect(ist360(5760, 2880)).toBe(true);   // Insta360 X3 export
    expect(ist360(4032, 3024)).toBe(false);  // normal iPhone photo
    expect(ist360(1000, 500)).toBe(false);   // too small to be a real panorama
    expect(ist360(null, null, '<GPano:ProjectionType>equirectangular</GPano:ProjectionType>')).toBe(true);
  });
});
