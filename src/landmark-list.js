// Real Edmonton landmarks drawn as hand-made models (see src/landmarks/*.js), shared by
// the map builder (which drops the generic footprints under them and notes which routes
// pass them) and the game (which places the models by latitude/longitude).
//
// Fields: id (= module name in src/landmarks/), name, lon/lat of the model origin, yaw in
// degrees clockwise from above, excludeR = radius (m) in which generic building footprints
// are dropped, callout = text shown on the HUD when driving past (null = none),
// seeFrom = how far (m) from the road it still counts as "passing it".
export const LANDMARK_LIST = [
  { id: 'legislature', name: 'Alberta Legislature', lon: -113.506573, lat: 53.533649, yaw: 0, excludeR: 75, callout: 'Alberta Legislature', seeFrom: 220 },
  { id: 'skyline', name: 'Downtown skyline', lon: -113.496647, lat: 53.545045, yaw: 0, excludeR: 0, callout: null, seeFrom: 0 },
  { id: 'muttart', name: 'Muttart Conservatory', lon: -113.478135, lat: 53.535236, yaw: 0, excludeR: 60, callout: 'Muttart Conservatory', seeFrom: 320 },
  { id: 'hotelmac', name: 'Hotel Macdonald', lon: -113.489489, lat: 53.540312, yaw: 0, excludeR: 48, callout: 'Hotel Macdonald', seeFrom: 600 },
  { id: 'highlevel', name: 'High Level Bridge', lon: -113.511138, lat: 53.52994, yaw: 0, excludeR: 0, callout: 'High Level Bridge', seeFrom: 120 },
  { id: 'rossdale', name: 'Rossdale Power Plant', lon: -113.49871, lat: 53.529138, yaw: 0, excludeR: 70, callout: 'Rossdale Power Plant', seeFrom: 260 },
  { id: 'refinery', name: 'Refinery Row', lon: -113.389669, lat: 53.549747, yaw: 0, excludeR: 0, callout: 'Refinery Row', seeFrom: 1150 },
  { id: 'tankfarm', name: 'Enbridge tank farm', lon: -113.349547, lat: 53.543571, yaw: 0, excludeR: 0, callout: 'Enbridge tank farm', seeFrom: 500 },
  { id: 'suncor', name: 'Suncor refinery', lon: -113.349003, lat: 53.560718, yaw: 0, excludeR: 0, callout: null, seeFrom: 0 },
  { id: 'watertower', name: 'Sherwood Park water tower', lon: -113.318436, lat: 53.51978, yaw: 0, excludeR: 15, callout: 'Sherwood Park water tower', seeFrom: 160 },
  { id: 'lafarge', name: 'Lafarge concrete plant', lon: -113.476654, lat: 53.427564, yaw: 0, excludeR: 0, callout: 'Lafarge plant', seeFrom: 280 },
  { id: 'containers', name: 'CPKC container terminal', lon: -113.488582, lat: 53.471753, yaw: 0, excludeR: 0, callout: 'CPKC container yard', seeFrom: 260 },
  { id: 'snowvalley', name: 'Snow Valley ski hill', lon: -113.5583, lat: 53.4844, yaw: 0, excludeR: 0, callout: 'Snow Valley', seeFrom: 300 },
];
