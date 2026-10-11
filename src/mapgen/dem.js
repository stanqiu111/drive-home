// Terrain heights from NRCan's MRDEM-30 digital terrain model (30 m, OGL-Canada), read
// straight from its cloud-optimised GeoTIFF on S3 with HTTP range requests (only the
// blocks a map needs are downloaded). Works in Node (tools/build-maps.mjs) and in browsers
// (the custom-route builder): the bucket allows cross-origin range requests.
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';

proj4.defs('EPSG:3979', '+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const DEM_URL = 'https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif';
const arrMin = (a) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const arrMax = (a) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
let demImage;

// points: [[lon, lat]] → elevations in metres (bilinear).
export async function sampleDEM(points) {
  if (!demImage) {
    const tif = await fromUrl(DEM_URL);
    demImage = await tif.getImage();
  }
  const [ox, oy] = demImage.getOrigin();
  const [rx, ry] = demImage.getResolution();
  const xy = points.map(([lon, lat]) => proj4('EPSG:4326', 'EPSG:3979', [lon, lat]));
  const px = xy.map(([x]) => (x - ox) / rx - 0.5);
  const py = xy.map(([, y]) => (y - oy) / ry - 0.5);
  const x0 = Math.floor(arrMin(px)) - 1;
  const y0 = Math.floor(arrMin(py)) - 1;
  const x1 = Math.ceil(arrMax(px)) + 2;
  const y1 = Math.ceil(arrMax(py)) + 2;
  const [data] = await demImage.readRasters({ window: [x0, y0, x1, y1] });
  const w = x1 - x0;
  const at = (i, j) => data[j * w + i];
  return px.map((fx, k) => {
    const ix = fx - x0;
    const iy = py[k] - y0;
    const i = Math.floor(ix);
    const j = Math.floor(iy);
    const u = ix - i;
    const v = iy - j;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  });
}
