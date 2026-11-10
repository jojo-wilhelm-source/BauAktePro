/** Genaue Verortung: derive the room from a pin (docs/fachkonzept/04-maengel.md). */
export interface LocationArea {
  location_id: string;
  plan_id: string;
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Room under a pin (relative coordinates 0..1). Only a suggestion: the person can change it.
 * Overlapping areas (e.g. a niche drawn inside a room): the smallest area wins.
 */
export function roomAt(areas: readonly LocationArea[], pin: { plan_id: string; page: number; x: number; y: number }): string | null {
  const hits = areas.filter(
    (a) => a.plan_id === pin.plan_id && a.page === pin.page && pin.x >= a.x0 && pin.x <= a.x1 && pin.y >= a.y0 && pin.y <= a.y1,
  );
  if (!hits.length) return null;
  hits.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
  return hits[0]!.location_id;
}
