/**
 * Shared world-map canvas registry for Regulations overlays.
 * world-map.ts registers once geo data is loaded; build-codes / buildable-land
 * render into the same SVG + zoom instead of spawning separate map surfaces.
 */
import type { Selection } from 'd3-selection';
import type { GeoProjection, GeoPath } from 'd3-geo';
import type { ZoomBehavior } from 'd3-zoom';

export interface MapHost {
    width: number;
    height: number;
    svg: Selection<SVGSVGElement, unknown, any, any>;
    mapG: Selection<SVGGElement, unknown, any, any>;
    regulationsG: Selection<SVGGElement, unknown, any, any>;
    projection: GeoProjection;
    path: GeoPath<any, any>;
    zoom: ZoomBehavior<any, unknown>;
    geoData: GeoJSON.FeatureCollection;
    /** ISO 3166-1 alpha-3 to alpha-2 mapping (e.g. "DEU" -> "DE"). */
    countryCode3to2: Record<string, string>;
    /** Neutral world basemap from policy country paths (pointer-events off). */
    showRegulationBasemap: () => void;
    /** Re-enable policy country interaction; call updateMap() to restore fills. */
    restorePolicyBasemap: () => void;
    hideDefaultLegend: () => void;
    showDefaultLegend: () => void;
    clearRegulationsLayer: () => void;
    applyWorldZoom: () => void;
    applyEuropeZoom: () => void;
}

let registered: MapHost | null = null;

export function registerMapHost(host: MapHost): void {
    registered = host;
}

export function getMapHost(): MapHost | null {
    return registered;
}
