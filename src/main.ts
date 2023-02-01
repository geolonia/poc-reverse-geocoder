// import type { Feature } from 'geojson'
import turfBooleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { lngLatToGoogle } from 'global-mercator'
import Protobuf from 'pbf'
import _fetch from 'cross-fetch'
import { VectorTile } from '@mapbox/vector-tile'
import { Feature, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'

const isBrowser = !(
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node !== 'undefined'
)

const fetch = isBrowser ? _fetch.bind(window) : _fetch

const DEFAULT_FETCH_HEADERS: HeadersInit = isBrowser
  ? {}
  : {
      Origin: 'http://localhost:8000',
    }

export interface ReverseGeocodingResult {
  code: string
  prefecture: string
  city: string
  oaza?: string
  koaza?: string
  chiban?: string
  chome?: string
}

type LngLat = [number, number]

export interface ReverseGeocodingSource {
  /** どのズームを使うか。デフォルトは 10 */
  zoomBase: number

  /** タイルが入ってるURLフォーマット。 */
  tileUrl: string

  // 検索するレイヤーのID
  layer: string

  attributeMap: Partial<ReverseGeocodingResult>
}

export interface ReverseGeocodingOptions {
  sources: ReverseGeocodingSource[]
}

const DEFAULT_ORG_SOURCE: ReverseGeocodingSource = {
  zoomBase: 10,
  tileUrl: `https://geolonia.github.io/open-reverse-geocoder/tiles/{z}/{x}/{y}.pbf`,
  layer: 'japanese-admins',
  attributeMap: {
    code: 'code',
    prefecture: 'prefecture',
    city: 'city',
  },
}

const DEFAULT_MOJ_SOURCE: ReverseGeocodingSource = {
  zoomBase: 15,
  tileUrl: `https://tileserver-dev.geolonia.com/moj_regmap/tiles.json?key=YOUR-API-KEY`,
  layer: 'moj_regmap',
  attributeMap: {
    chiban: '地番',
    koaza: '小字名',
    oaza: '大字名',
    chome: '丁目名',
  },
}

const DEFAULT_OPTIONS: ReverseGeocodingOptions = {
  sources: [DEFAULT_ORG_SOURCE, DEFAULT_MOJ_SOURCE],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TILEJSON_CACHE: { [key: string]: any } = {}
const TILE_CACHE: { [key: string]: VectorTile } = {}
async function getTile(
  tileUrl: string,
  x: number,
  y: number,
  z: number,
): Promise<VectorTile> {
  let _tileUrl = tileUrl

  if (new URL(tileUrl).pathname.endsWith('.json')) {
    let tilejson = TILEJSON_CACHE[tileUrl]
    if (!tilejson) {
      const res = await fetch(tileUrl, {
        headers: DEFAULT_FETCH_HEADERS,
      })
      tilejson = TILEJSON_CACHE[tileUrl] = await res.json()
    }
    _tileUrl = tilejson.tiles[0]
  }

  const requestUrl = _tileUrl
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))

  let tile = TILE_CACHE[requestUrl]
  if (typeof tile !== 'undefined') {
    return tile
  }
  const res = await fetch(requestUrl, {
    headers: DEFAULT_FETCH_HEADERS,
  })
  const buffer = await res.arrayBuffer()
  tile = TILE_CACHE[requestUrl] = new VectorTile(new Protobuf(buffer))
  return tile
}

export const singleGeocode: (
  input: LngLat,
  options?: Partial<ReverseGeocodingSource>,
) => Promise<Partial<ReverseGeocodingResult> | undefined> = async (
  lnglat,
  inputOptions = {},
) => {
  const options: ReverseGeocodingSource = {
    ...DEFAULT_ORG_SOURCE,
    ...inputOptions,
  }

  const z = options.zoomBase
  const [x, y] = lngLatToGoogle(lnglat, options.zoomBase)

  const tile = await getTile(options.tileUrl, x, y, z)
  let layers = Object.keys(tile.layers)

  if (!Array.isArray(layers)) layers = [layers]

  for (const layerID of layers) {
    const layer = tile.layers[layerID]
    if (!layer || options.layer !== layer.name) {
      continue
    }
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i).toGeoJSON(x, y, z)
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
      if (!res) {
        continue
      }

      const props: { [key: string]: string } = {
        code:
          5 === String(feature.id).length
            ? String(feature.id)
            : `0${String(feature.id)}`,
        ...feature.properties,
      }

      const output: { [key: string]: string } = {}
      for (const [destKey, srcKey] of Object.entries(options.attributeMap)) {
        if (!srcKey || !props[srcKey]) continue
        output[destKey] = props[srcKey]
      }
      return output
    }
  }

  return undefined
}

export async function openReverseGeocoder(
  input: LngLat,
  options: ReverseGeocodingOptions = DEFAULT_OPTIONS,
): Promise<Partial<ReverseGeocodingResult> | undefined> {
  const rawResults = await Promise.all(
    options.sources.map((options) => singleGeocode(input, options)),
  )
  const output: Partial<ReverseGeocodingResult> = {}
  for (const result of rawResults) {
    if (typeof result === undefined) continue
    Object.assign(output, result)
  }
  if ('code' in output && 'prefecture' in output && 'city' in output) {
    return output
  } else {
    return undefined
  }
}
