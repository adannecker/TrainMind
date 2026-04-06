export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const MAP_TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const rawMapMaxZoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM ?? 19);
export const MAP_MAX_ZOOM = Number.isFinite(rawMapMaxZoom) ? rawMapMaxZoom : 19;
