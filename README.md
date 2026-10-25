# @devicefarmer/stf-device-db

**@devicefarmer/stf-device-db** is an open-data smartphone, tablet, and wearable database with deterministic dynamic SVG generation for [DeviceFarmer STF](https://github.com/DeviceFarmer/stf).

## Data Pipeline & Sources

The database (`dist/devices.json`) is generated automatically using `scripts/build-db.mjs` with zero native binary dependencies (Node.js 20+ native `fetch`):

1. **Google Play Supported Devices** (`supported_devices.csv`) — Retail branding, marketing name, device codename, and model identifiers (licensed under **CC-BY-4.0**).
2. **LineageOS Wiki** (`LineageOS/lineage_wiki`) — Hardware specifications (`release`, `soc`, `cpu_cores`, `cpu_freq`, `ram`, `storage`) streamed from the repository tarball (licensed under **CC-BY-SA-3.0**).
3. **Wikidata SPARQL** (`query.wikidata.org`) — Publication/release dates (`P577`) for smartphone and tablet models (`wd:Q19723451`, `wd:Q17517`, `wd:Q155972`) (dedicated to the public domain under **CC0**).

## Requirements

* [Node.js](https://nodejs.org/) >= 20

## Building & Testing

To rebuild `dist/devices.json` from upstream open data sources and verify the database:

```bash
npm install
npm run build
npm test
```

## Usage

Install via NPM:

```bash
npm install --save @devicefarmer/stf-device-db
```

### `find(properties)`

Query device metadata by `model` (primary, case-insensitive), `name` (codename fallback / disambiguator), and optional `brand` / `manufacturer` / `platform` guards:

```javascript
const db = require('@devicefarmer/stf-device-db')

const data = db.find({
  model: 'Nexus 5',
  name: 'hammerhead',
  manufacturer: 'LGE'
})
```

`data` returns:

```javascript
{
  name: { id: 'Nexus 5', long: 'LGE Nexus 5' },
  brand: 'LGE',
  marketName: 'Nexus 5',
  date: '2013-10-31',
  cpu: {
    name: 'Qualcomm MSM8974 Snapdragon 800',
    cores: 4,
    freq: 2.26
  },
  memory: {
    ram: 2048, // MB
    rom: 16    // GB
  },
  image: 'Nexus_5.svg'
}
```

If neither `model` nor `name` matches an entry in `dist/devices.json` (or `platform` is non-Android, or `brand`/`manufacturer` belongs to a conflicting OEM), `find()` returns `null`.

### `sample()` & `brandsMatch(a, b)`

* `db.sample()` returns a random device record (`{ model, name, brand, marketName, date, cpu, memory, image }`) from `dist/devices.json` for test/mock device generation.
* `db.brandsMatch(a, b)` checks whether two brand/manufacturer strings belong to the same OEM brand family (e.g. `Xiaomi`/`Redmi`/`POCO`, `HMD Global`/`Nokia`, `Motorola`/`Lenovo`, `Nothing`/`CMF by Nothing`).

### `generateDeviceSvg(params)` & `getDeviceSvgDataUri(params)`

Generate deterministic, form-factor-aware device SVGs (`x24`, `x120`, `x800`) across `wearable`, `foldable-tablet`, `legacy-16-9`, `modern-punch-hole`, and `ultra-tall-21-9` profiles:

```javascript
const svg = db.generateDeviceSvg({
  model: 'Pixel 9',
  name: 'tokay',
  width: 1080,
  height: 2424,
  xdpi: 422,
  ydpi: 422,
  sdk: 34,
  size: 'x120'
})

const dataUri = db.getDeviceSvgDataUri({ model: 'Pixel 9', size: 'x24' })
```

### Migrating from v1.x to v2.0

* Static JPEG files under `dist/icon/*` and `dist/photo/*` (and `dist/devices-latest.json`) are replaced by `dist/devices.json` + runtime `generateDeviceSvg()` / `getDeviceSvgDataUri()`.
* `memory.ram` remains in **MB**, while `memory.rom` is now in **GB** (matching STF 3.8+ hardware probes).
* Legacy `carrier`, `maker`, `os`, `display`, and `flags` fields from `1.x` were replaced by `brand`, `marketName`, `YYYY-MM-DD` `date`, nullable `cpu`/`memory`, and `image` SVG tokens.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

* **Data (`dist/devices.json`)**: Licensed under [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/) (derived from Google Play CC-BY-4.0, LineageOS CC-BY-SA-3.0, and Wikidata CC0).
* **Code (`index.js`, `index.d.ts`, `scripts/*`, `test/*`)**: Licensed under [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).

See [LICENSE](LICENSE) for full details.
