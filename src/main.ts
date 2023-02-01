// import type { Feature } from 'geojson'
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { lngLatToGoogle } from 'global-mercator'
import Protobuf from 'pbf'
import fetch from 'cross-fetch'
import { VectorTile } from '@mapbox/vector-tile'
import { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'

export interface ReverseGeocodingResult {
  code: string
  prefecture: string
  city: string
}

type LngLat = [number, number]

export interface ReverseGeocodingOptions {
  /** どのズームを使うか。デフォルトは 10 */
  zoomBase: number

  /** タイルが入ってるURLフォーマット。 */
  tileUrl: string

  // 検索するレイヤーのID
  layer: string
}

const DEFAULT_OPTIONS: ReverseGeocodingOptions = {
  zoomBase: 10,
  tileUrl: `https://geolonia.github.io/open-reverse-geocoder/tiles/{z}/{x}/{y}.pbf`,
  layer: 'japanese-admins',
}

const TILE_CACHE: { [key: string]: VectorTile } = {}
async function getTile(
  tileUrl: string,
  x: number,
  y: number,
  z: number,
): Promise<VectorTile> {
  const requestUrl = tileUrl
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))

  let tile = TILE_CACHE[requestUrl]
  if (typeof tile !== 'undefined') {
    return tile
  }
  const res = await fetch(requestUrl)
  const buffer = await res.arrayBuffer()
  console.log(requestUrl, res.statusText)
  tile = TILE_CACHE[requestUrl] = new VectorTile(new Protobuf(buffer))
  return tile
}

export const openReverseGeocoder: (
  input: LngLat,
  options?: Partial<ReverseGeocodingOptions>,
) => Promise<ReverseGeocodingResult> = async (lnglat, inputOptions = {}) => {
  const options: ReverseGeocodingOptions = {
    ...DEFAULT_OPTIONS,
    ...inputOptions,
  }
  const [x, y] = lngLatToGoogle(lnglat, options.zoomBase)

  const geocodingResult = {
    code: '',
    prefecture: '',
    city: '',
  }

  const tile = await getTile(options.tileUrl, x, y, options.zoomBase)
  let layers = Object.keys(tile.layers)

  if (!Array.isArray(layers)) layers = [layers]

  for (const layerID of layers) {
    const layer = tile.layers[layerID]
    if (!layer || options.layer !== layer.name) {
      continue
    }
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i).toGeoJSON(x, y, options.zoomBase)
      // if (layers.length > 1) feature.properties.vt_layer = layerID

      if (
        feature.geometry.type !== 'Polygon' &&
        feature.geometry.type !== 'MultiPolygon'
      ) {
        continue
      }

      const res = turfBooleanPointInPolygon(
        {
          type: 'Point',
          coordinates: lnglat,
        },
        feature as Feature<Polygon | MultiPolygon, GeoJsonProperties>,
      )
      if (res) {
        geocodingResult.code =
          5 === String(feature.id).length
            ? String(feature.id)
            : `0${String(feature.id)}`
        geocodingResult.prefecture = feature.properties?.prefecture
        geocodingResult.city = feature.properties?.city

        return geocodingResult
      }
    }
  }

  return geocodingResult
}
