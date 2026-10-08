import * as THREE from 'three';

// Example landmark module (not in LANDMARK_LIST, so it is never placed in the game).
// build(ctx) returns a THREE.Group in metres: x = east, z = south, y = up; the origin is
// ground level under the landmark's lon/lat. ctx.mat(color, finish) gives cached
// materials (finish: matte | glossy | metal | glass | glow). ctx.local(lon, lat) converts
// another coordinate into metres from this origin. ctx.ground(x, z) gives the real terrain
// height relative to the origin (null in the studio, so keep a fallback) for sites on slopes;
// ctx.onRoad(x, z) says whether a spot is on a road, to keep trees and props off streets.
// Keep models cheap (a few thousand triangles): merge repeated parts where you can.
export const sink = 0; // optional: raise/lower the whole model (m)

export function build(ctx) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 12).translate(0, 5, 0), ctx.mat(0xc9b899));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 10, 0), ctx.mat(0xbeb295, 'glossy'));
  g.add(base, dome);
  return g;
}
