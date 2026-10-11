// Downtown Edmonton's recognisable towers, drawn by src/landmarks/skyline.js and used by the
// map builder to drop the generic footprints under them. Pure data: no three import.
//
// Fields: id, name, lon/lat = centre of the tower (OSM building centroid), h = height to the
// roof in metres (Epcor: to its spires), w/d = footprint east-west / north-south in metres
// (including the podium where the OSM polygon has one), yaw = degrees clockwise from north,
// excludeR = radius (m) in which generic building footprints are removed (half the footprint
// diagonal + 5), look = what it looks like from a kilometre away.
export const SKYLINE_TOWERS = [
  { id: 'stantec', name: 'Stantec Tower', lon: -113.496647, lat: 53.545045, h: 251, w: 97, d: 73, yaw: 0, excludeR: 66,
    look: '66-floor blue glass tower (~50 x 45 m) with thin white vertical fins on a wide podium; the top steps back on the north side with a lit pale crown.' },
  { id: 'marriott', name: 'JW Marriott Ice District', lon: -113.496434, lat: 53.545722, h: 191, w: 64, d: 67, yaw: 0, excludeR: 51,
    look: '56-floor hotel slab (~62 x 40 m) in blue glass with a brownish-red glass strip on its west side; two-step lighter crown.' },
  { id: 'epcor', name: 'Epcor Tower', lon: -113.492914, lat: 53.547407, h: 149, w: 82, d: 58, yaw: 0, excludeR: 55,
    look: 'Wide pale blue-green glass block (82 x 58 m, roof 137 m) gridded by white frames; two white spires rise to 149 m.' },
  { id: 'atb', name: 'ATB Place (TELUS House)', lon: -113.491402, lat: 53.540108, h: 134, w: 42, d: 58, yaw: 0, excludeR: 41,
    look: 'Dark green-bronze glass office slab, 42 x 58 m, on the river bluff.' },
  { id: 'edmontonhouse', name: 'Edmonton House', lon: -113.495034, lat: 53.538442, h: 121, w: 33, d: 32, yaw: 0, excludeR: 28,
    look: 'Very slim pale-beige concrete apartment tower, 33 x 32 m, with a balcony grid on every floor and vertical ribs.' },
  { id: 'lacombe', name: 'Chateau Lacombe', lon: -113.493924, lat: 53.539121, h: 80, w: 52, d: 44, yaw: 0, excludeR: 39,
    look: 'Ribbed brown concrete cylinder, 30 m across, with a flared revolving-restaurant top, on a low podium.' },
  { id: 'nationalbank', name: 'National Bank Centre (Manulife Place)', lon: -113.494395, lat: 53.542628, h: 146, w: 40, d: 59, yaw: 0, excludeR: 41,
    look: 'Dark green reflective glass tower, 40 x 59 m, on a wide low shopping podium.' },
  { id: 'bell', name: 'Bell Tower', lon: -113.494326, lat: 53.544986, h: 130, w: 43, d: 43, yaw: 0, excludeR: 35,
    look: 'Grey glass tower with notched corners and horizontal aluminium bands.' },
  { id: 'edmontontower', name: 'Edmonton Tower', lon: -113.494793, lat: 53.545761, h: 130, w: 94, d: 55, yaw: 0, excludeR: 60,
    look: 'Light blue glass tower in a white picture frame, sloped roof, on a podium that spans the block.' },
  { id: 'commerce', name: 'Commerce Place', lon: -113.49515, lat: 53.542035, h: 125, w: 37, d: 67, yaw: 0, excludeR: 43,
    look: 'Teal glass and pink-grey granite tower, 37 x 67 m, with a stepped ziggurat crown above the Shops at Commerce Place.' },
  { id: 'cntower', name: 'CN Tower', lon: -113.491395, lat: 53.546925, h: 111, w: 48, d: 81, yaw: 0, excludeR: 52,
    look: '1966 beige precast concrete grid slab, long north-south, dark windows in the grid.' },
  { id: 'enbridge', name: 'Enbridge Centre', lon: -113.493234, lat: 53.542458, h: 111, w: 70, d: 52, yaw: 0, excludeR: 49,
    look: 'Blue glass tower in a pale frame rising from a red-brick heritage base (the Kelly Ramsey block).' },
  { id: 'encore', name: 'Encore Tower', lon: -113.497903, lat: 53.542796, h: 138, w: 36, d: 37, yaw: 0, excludeR: 31,
    look: '43-floor white residential tower with blue-green glass and balcony slabs every second floor.' },
];
