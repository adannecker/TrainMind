export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const MAP_TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const MAP_3D_DEM_URL =
  typeof import.meta.env.VITE_MAP_3D_DEM_URL === "string" && import.meta.env.VITE_MAP_3D_DEM_URL.trim()
    ? import.meta.env.VITE_MAP_3D_DEM_URL.trim()
    : "https://tiles.mapterhorn.com/tilejson.json";
export const MAP_3D_STYLE_URL =
  typeof import.meta.env.VITE_MAP_3D_STYLE_URL === "string" && import.meta.env.VITE_MAP_3D_STYLE_URL.trim()
    ? import.meta.env.VITE_MAP_3D_STYLE_URL.trim()
    : "https://tiles.openfreemap.org/styles/liberty";

const rawMap3dDemEncoding = import.meta.env.VITE_MAP_3D_DEM_ENCODING;
export const MAP_3D_DEM_ENCODING = rawMap3dDemEncoding === "mapbox" ? "mapbox" : "terrarium";

const rawMap3dDemTileSize = Number(import.meta.env.VITE_MAP_3D_DEM_TILE_SIZE ?? 512);
export const MAP_3D_DEM_TILE_SIZE = Number.isFinite(rawMap3dDemTileSize) ? rawMap3dDemTileSize : 512;

const rawMapMaxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM ?? 19);
export const MAP_MAX_ZOOM = Number.isFinite(rawMapMaxZoom) ? rawMapMaxZoom : 19;

const rawMap3dPitch = Number(import.meta.env.VITE_MAP_3D_PITCH ?? 70);
export const MAP_3D_PITCH = Number.isFinite(rawMap3dPitch) ? rawMap3dPitch : 70;

const rawMap3dMaxPitch = Number(import.meta.env.VITE_MAP_3D_MAX_PITCH ?? 85);
export const MAP_3D_MAX_PITCH = Number.isFinite(rawMap3dMaxPitch) ? rawMap3dMaxPitch : 85;

const rawMap3dBearing = Number(import.meta.env.VITE_MAP_3D_BEARING ?? -36);
export const MAP_3D_BEARING = Number.isFinite(rawMap3dBearing) ? rawMap3dBearing : -36;

const rawMap3dExaggeration = Number(import.meta.env.VITE_MAP_3D_EXAGGERATION ?? 1.2);
export const MAP_3D_EXAGGERATION = Number.isFinite(rawMap3dExaggeration) ? rawMap3dExaggeration : 1.2;
