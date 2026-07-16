import { cellToBoundary, cellToLatLng } from "h3-js";

/** Convert an H3 cell ID to a GeoJSON Polygon geometry. */
export function cellToPolygon(cellId: string): GeoJSON.Polygon {
  const boundary = cellToBoundary(cellId, true); // true = [lng, lat] order
  return {
    type: "Polygon",
    coordinates: [[...boundary, boundary[0]]],  // close the ring
  };
}

/** Convert an H3 cell ID to a [longitude, latitude] centroid. */
export function cellToCentroid(cellId: string): [number, number] {
  const [lat, lng] = cellToLatLng(cellId);
  return [lng, lat];
}

/** Convert an array of H3 cells to a GeoJSON FeatureCollection. */
export function cellsToFeatureCollection<P extends Record<string, unknown>>(
  cells: Array<{ cell: string } & P>
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cells.map((item) => ({
      type: "Feature",
      geometry: cellToPolygon(item.cell),
      properties: item,
    })),
  };
}
