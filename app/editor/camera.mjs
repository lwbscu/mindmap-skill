const DEFAULT_MIN_ZOOM = 0.12;
const DEFAULT_MAX_ZOOM = 4;

export function createCamera(options = {}) {
  return {
    x: options.x ?? 0,
    y: options.y ?? 0,
    zoom: clampZoom(options.zoom ?? 1, options),
    minZoom: options.minZoom ?? DEFAULT_MIN_ZOOM,
    maxZoom: options.maxZoom ?? DEFAULT_MAX_ZOOM,
  };
}

export function clampZoom(zoom, camera = {}) {
  const minZoom = camera.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = camera.maxZoom ?? DEFAULT_MAX_ZOOM;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

export function screenToWorld(camera, point) {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

export function worldToScreen(camera, point) {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

export function panByScreen(camera, delta) {
  return {
    ...camera,
    x: camera.x + delta.x,
    y: camera.y + delta.y,
  };
}

export function panByWorld(camera, delta) {
  return panByScreen(camera, {
    x: delta.x * camera.zoom,
    y: delta.y * camera.zoom,
  });
}

export function setZoomAt(camera, screenPoint, zoom) {
  const nextZoom = clampZoom(zoom, camera);
  const worldPoint = screenToWorld(camera, screenPoint);

  return {
    ...camera,
    zoom: nextZoom,
    x: screenPoint.x - worldPoint.x * nextZoom,
    y: screenPoint.y - worldPoint.y * nextZoom,
  };
}

export function zoomBy(camera, screenPoint, factor) {
  return setZoomAt(camera, screenPoint, camera.zoom * factor);
}

export function zoomFromWheel(camera, screenPoint, deltaY, options = {}) {
  const sensitivity = options.sensitivity ?? 0.0018;
  const factor = Math.exp(-deltaY * sensitivity);
  return zoomBy(camera, screenPoint, factor);
}

export function fitBounds(camera, bounds, viewport, options = {}) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { ...camera };
  }

  const padding = options.padding ?? 80;
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(availableWidth / bounds.width, availableHeight / bounds.height), camera);
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  return {
    ...camera,
    zoom,
    x: viewport.width / 2 - center.x * zoom,
    y: viewport.height / 2 - center.y * zoom,
  };
}

export function cameraToTransform(camera) {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
}

export function copyCamera(camera) {
  return {
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom,
    minZoom: camera.minZoom,
    maxZoom: camera.maxZoom,
  };
}
