// Real Edmonton landmarks drawn as hand-made models (see src/landmarks/*.js), shared by
// the map builder (which drops the generic footprints under them and notes which routes
// pass them) and the game (which places the models by latitude/longitude).
//
// Fields: id (= module name in src/landmarks/), name, lon/lat of the model origin, yaw in
// degrees clockwise from above, excludeR = radius (m) in which generic building footprints
// and trees are dropped (or excludeBox = [halfWidth east-west, halfDepth north-south,
// optional centre offset east, offset south] for big sites), callout = text shown on the HUD when driving past (null = none),
// seeFrom = how far (m) from the road it still counts as "passing it".
export const LANDMARK_LIST = [
  { id: 'legislature', name: 'Alberta Legislature', lon: -113.506573, lat: 53.533649, yaw: 0, excludeBox: [56, 99, -3, -47], callout: 'Alberta Legislature', seeFrom: 220 },
  { id: 'skyline', name: 'Downtown skyline', lon: -113.496647, lat: 53.545045, yaw: 0, excludeR: 0, callout: null, seeFrom: 0 },
  { id: 'muttart', name: 'Muttart Conservatory', lon: -113.478135, lat: 53.535236, yaw: 0, excludeBox: [62, 68, 59, 4], callout: 'Muttart Conservatory', seeFrom: 320 },
  { id: 'hotelmac', name: 'Hotel Macdonald', lon: -113.489489, lat: 53.540312, yaw: 0, excludeBox: [42, 43, 7, 6], callout: 'Hotel Macdonald', seeFrom: 600 },
  { id: 'highlevel', name: 'High Level Bridge', lon: -113.511138, lat: 53.52994, yaw: 0, excludeR: 0, callout: 'High Level Bridge', seeFrom: 120 },
  { id: 'rossdale', name: 'Rossdale Power Plant', lon: -113.49871, lat: 53.529138, yaw: 0, excludeBox: [33, 63, 4.5, 0], callout: 'Rossdale Power Plant', seeFrom: 260 },
  { id: 'refinery', name: 'Refinery Row', lon: -113.389669, lat: 53.549747, yaw: 0, excludeBox: [820, 507, 28, 430], callout: 'Refinery Row', seeFrom: 1150 },
  { id: 'tankfarm', name: 'Enbridge tank farm', lon: -113.349547, lat: 53.543571, yaw: 0, excludeBox: [397, 460, -75, -93], callout: 'Enbridge tank farm', seeFrom: 500 },
  { id: 'suncor', name: 'Suncor refinery', lon: -113.349003, lat: 53.560718, yaw: 0, excludeBox: [341, 353, -112, 166], callout: null, seeFrom: 0 },
  { id: 'watertower', name: 'Sherwood Park water tower', lon: -113.318436, lat: 53.51978, yaw: 0, excludeR: 15, callout: 'Sherwood Park water tower', seeFrom: 160 },
  { id: 'lafarge', name: 'Lafarge concrete plant', lon: -113.476654, lat: 53.427564, yaw: 0, excludeBox: [57, 64, 4, 2], callout: 'Lafarge plant', seeFrom: 280 },
  { id: 'containers', name: 'CPKC container terminal', lon: -113.488582, lat: 53.471753, yaw: 0, excludeBox: [151, 272], callout: 'CPKC container yard', seeFrom: 330 },
  { id: 'snowvalley', name: 'Snow Valley ski hill', lon: -113.5583, lat: 53.4844, yaw: 0, excludeBox: [180, 170, -142, -12], callout: 'Snow Valley', seeFrom: 300 },
  { id: 'rogersplace', name: 'Rogers Place', lon: -113.4978, lat: 53.5468, yaw: 0, excludeBox: [115, 74, 30, -14], callout: 'Rogers Place', seeFrom: 300 },
  { id: 'cityhall', name: 'Edmonton City Hall', lon: -113.4901647, lat: 53.5454723, yaw: 0, excludeBox: [42, 79, 0, 11], callout: 'City Hall', seeFrom: 220 },
  { id: 'aga', name: 'Art Gallery of Alberta', lon: -113.4886039, lat: 53.5449908, yaw: 0, excludeBox: [34, 26, 0, 4], callout: 'Art Gallery of Alberta', seeFrom: 200 },
  { id: 'ram', name: 'Royal Alberta Museum', lon: -113.4890812, lat: 53.5471477, yaw: 0, excludeBox: [80, 75, 0, 0], callout: 'Royal Alberta Museum', seeFrom: 200 },
  { id: 'commonwealth', name: 'Commonwealth Stadium', lon: -113.4764233, lat: 53.5596586, yaw: 0, excludeBox: [148, 125, 17, -3], callout: 'Commonwealth Stadium', seeFrom: 350 },
  { id: 'telus', name: 'TELUS World of Science', lon: -113.5644198, lat: 53.5612204, yaw: 0, excludeBox: [72, 74, 26, 2], callout: 'TELUS World of Science', seeFrom: 320 },
  { id: 'convention', name: 'Edmonton Convention Centre', lon: -113.4858137, lat: 53.5411497, yaw: 0, excludeBox: [82, 78, 4, -14], callout: 'Convention Centre', seeFrom: 260 },
  { id: 'southgate', name: 'Southgate Centre', lon: -113.5141429, lat: 53.4857654, yaw: 0, excludeBox: [155, 182, 35, 2], callout: 'Southgate Centre', seeFrom: 300 },
  { id: 'kingsway', name: 'Kingsway Mall', lon: -113.5058855, lat: 53.5629678, yaw: 0, excludeBox: [120, 225, 50, 87], callout: 'Kingsway Mall', seeFrom: 470 },
  { id: 'talus', name: 'Talus Dome', lon: -113.5658818, lat: 53.5046356, yaw: 0, excludeR: 8, callout: 'Talus Dome', seeFrom: 120 },
  { id: 'wem', name: 'West Edmonton Mall', lon: -113.6227, lat: 53.5231, yaw: 0, excludeBox: [420, 215, -25, 65], callout: 'West Edmonton Mall', seeFrom: 520 },
];
