import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db, { find, sample, brandsMatch, generateDeviceSvg, getDeviceSvgDataUri } from '../index.js'
import {
  parseCsvLine,
  normalizeBrandMarketKey,
  normalizeDate,
  parseCores,
  parseFreq,
  parseRamMb,
  parseStorageGb,
  applyLineageDoc,
  brandsAreCompatible
} from '../scripts/build-db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(__dirname, '../dist/devices.json')

function assertWellFormedSvg(svg, expectedSize) {
  assert.equal(typeof svg, 'string')
  assert.ok(svg.startsWith('<svg '), 'SVG must start with <svg')
  assert.ok(svg.endsWith('</svg>'), 'SVG must end with </svg>')
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'SVG must include xmlns')

  const dim = expectedSize === 'x24' ? '24' : (expectedSize === 'x800' ? '800' : '120')
  assert.ok(svg.includes(`viewBox="0 0 ${dim} ${dim}"`), `SVG must have ${dim}x${dim} viewBox`)
  assert.ok(svg.includes(`width="${dim}"`), `SVG must have width="${dim}"`)
  assert.ok(svg.includes(`height="${dim}"`), `SVG must have height="${dim}"`)
  assert.ok(svg.includes(`data-size="${expectedSize}"`), `SVG must include data-size="${expectedSize}"`)

  // Verify no unescaped ampersands (all '&' must be part of standard XML entity)
  const badAmp = svg.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '')
  assert.equal(badAmp.includes('&'), false, 'SVG must not contain unescaped ampersands')

  // Verify balanced tags
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(\s[^<>]*?)?(\/?)>/g
  const stack = []
  let match
  while ((match = tagRegex.exec(svg)) !== null) {
    const full = match[0]
    const tagName = match[1]
    const isClosing = full.startsWith('</')
    const isSelfClosing = match[3] === '/'

    if (isClosing) {
      assert.ok(stack.length > 0, `Unexpected closing tag </${tagName}>`)
      const top = stack.pop()
      assert.equal(top, tagName, `Mismatched closing tag: expected </${top}>, got </${tagName}>`)
    } else if (!isSelfClosing) {
      stack.push(tagName)
    }
  }
  assert.equal(stack.length, 0, `Unclosed XML tags remaining: ${stack.join(', ')}`)
}

test('dist/devices.json exists, has deterministic structure, and satisfies hardware sanity bounds', () => {
  assert.equal(fs.existsSync(distPath), true, 'dist/devices.json must exist')
  const raw = JSON.parse(fs.readFileSync(distPath, 'utf8'))
  assert.equal(typeof raw.models, 'object')
  assert.equal(typeof raw.codenames, 'object')
  assert.ok(Object.keys(raw.models).length > 10000, 'should have > 10000 models')
  assert.ok(Object.keys(raw.codenames).length > 5000, 'should have > 5000 codenames')

  for (const [section, entries] of [['models', raw.models], ['codenames', raw.codenames]]) {
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.c && entry.c.freq !== null) {
        assert.ok(
          entry.c.freq > 0 && entry.c.freq <= 10,
          `Invalid CPU freq ${entry.c.freq} in ${section}.${key}`
        )
      }
      if (entry.y && entry.y.rom !== null) {
        assert.ok(
          entry.y.rom > 0 && entry.y.rom <= 4096,
          `Invalid ROM ${entry.y.rom} GB in ${section}.${key}`
        )
      }
      if (entry.y && entry.y.ram !== null) {
        assert.ok(
          entry.y.ram > 0 && entry.y.ram <= 65536,
          `Invalid RAM ${entry.y.ram} MB in ${section}.${key}`
        )
      }
    }
  }
})

test('package exports find, sample, brandsMatch, generateDeviceSvg, getDeviceSvgDataUri and TypeScript definitions', () => {
  assert.equal(typeof db.find, 'function')
  assert.equal(typeof db.sample, 'function')
  assert.equal(typeof db.brandsMatch, 'function')
  assert.equal(typeof db.generateDeviceSvg, 'function')
  assert.equal(typeof db.getDeviceSvgDataUri, 'function')
  assert.equal(find, db.find)
  assert.equal(sample, db.sample)
  assert.equal(brandsMatch, db.brandsMatch)
  assert.equal(generateDeviceSvg, db.generateDeviceSvg)
  assert.equal(getDeviceSvgDataUri, db.getDeviceSvgDataUri)

  const picked = db.sample()
  assert.equal(typeof picked.model, 'string')
  assert.ok(picked.model.length > 0)
  assert.equal(typeof picked.brand, 'string')
  assert.equal(typeof picked.marketName, 'string')
  assert.equal(typeof picked.image, 'string')

  const dtsPath = path.resolve(__dirname, '../index.d.ts')
  assert.equal(fs.existsSync(dtsPath), true, 'index.d.ts must exist')
  const dtsContent = fs.readFileSync(dtsPath, 'utf8')
  assert.ok(dtsContent.includes('export function find'))
  assert.ok(dtsContent.includes('export function sample'))
  assert.ok(dtsContent.includes('export function brandsMatch'))
  assert.ok(dtsContent.includes('export function generateDeviceSvg'))
  assert.ok(dtsContent.includes('export function getDeviceSvgDataUri'))
  assert.ok(dtsContent.includes('export = stfDeviceDb'))
})

test('find() looks up known devices accurately, round-trips image stems, and prevents cross-vendor hijacks', () => {
  const a55 = db.find({ model: 'SM-A556B' })
  assert.ok(a55, 'should find SM-A556B')
  assert.deepEqual(a55.name, {
    id: 'Galaxy A55 5G',
    long: 'Samsung Galaxy A55 5G'
  })
  assert.equal(a55.brand, 'Samsung')
  assert.equal(a55.marketName, 'Galaxy A55 5G')
  assert.equal(a55.image, 'SM-A556B.svg')
  // Round-trip lookup via image stem (used by STF device-icons middleware)
  const a55Stem = a55.image.replace(/\.svg$/, '')
  assert.deepEqual(db.find({ model: a55Stem, name: a55Stem })?.marketName, 'Galaxy A55 5G')

  const pixel9ByCode = db.find({ model: 'UNKNOWN_PIXEL_PROTO', name: 'tokay' })
  assert.ok(pixel9ByCode, 'should find Pixel 9 by codename tokay')
  assert.deepEqual(pixel9ByCode.name, {
    id: 'Pixel 9',
    long: 'Google Pixel 9'
  })
  assert.equal(pixel9ByCode.brand, 'Google')
  assert.equal(pixel9ByCode.marketName, 'Pixel 9')
  assert.equal(pixel9ByCode.date, '2024-08-22')
  assert.deepEqual(pixel9ByCode.cpu, {
    name: 'Google Tensor G4',
    cores: 8,
    freq: 3.1
  })
  assert.deepEqual(pixel9ByCode.memory, {
    ram: 12288,
    rom: 128
  })
  assert.equal(pixel9ByCode.image, 'tokay.svg')

  // Verify codenames like cheetah, lynx, bullhead, hummer are not hijacked by unrelated brands
  assert.equal(db.find({ name: 'cheetah' })?.brand, 'Google')
  assert.equal(db.find({ name: 'lynx' })?.brand, 'Google')
  assert.ok(['Google', 'LG', 'LGE'].includes(db.find({ name: 'bullhead' })?.brand))
  assert.equal(db.find({ name: 'hummer' })?.brand, 'OnePlus')
  assert.equal(db.find({ model: 'CPH2581' })?.memory?.rom, 256)
  assert.equal(db.find({ model: 'M2012K11G' })?.cpu?.freq, 2.84)
  assert.equal(db.find({ name: 'I001D' })?.cpu?.freq, 2.964)
})

test('find() disambiguates shared models like Nexus 7 using codename or stock product alias', () => {
  const n7_2012 = db.find({ model: 'Nexus 7', name: 'nakasi' })
  assert.ok(n7_2012)
  assert.match(n7_2012.marketName, /2012/)

  const n7_2013 = db.find({ model: 'Nexus 7', name: 'razor' })
  assert.ok(n7_2013)
  assert.match(n7_2013.marketName, /2013/)
})

test('find() falls back to codename (name) when model does not match', () => {
  const res = db.find({ model: 'NON_EXISTENT_MODEL_XYZ', name: 'hammerhead' })
  assert.ok(res, 'should find hammerhead by codename fallback')
  assert.equal(res.marketName, 'Nexus 5')
  assert.equal(res.date, '2013-10-31')
  assert.deepEqual(res.cpu, {
    name: 'Qualcomm MSM8974 Snapdragon 800',
    cores: 4,
    freq: 2.26
  })
  assert.deepEqual(res.memory, {
    ram: 2048,
    rom: 16
  })
})

test('find() rejects Object.prototype keys, unknown models, non-Android platforms, and conflicting OEM brands', () => {
  assert.equal(db.find(), null)
  assert.equal(db.find(null), null)
  assert.equal(db.find({}), null)
  assert.equal(db.find({ model: 'constructor' }), null)
  assert.equal(db.find({ name: '__proto__' }), null)
  assert.equal(db.find({ model: 'toString', name: 'valueOf' }), null)
  assert.equal(db.find({ model: 'generic-phone-v1.svg' }), null)
  assert.equal(db.find({ model: '___unknown_proto_999___', name: '___unknown_code_999___' }), null)
  assert.equal(db.find({
    model: 'Proto-X1',
    brand: 'AcmeCorp',
    marketName: 'Acme Prototype X1'
  }), null)
  assert.equal(db.find({ model: 'SM-A556B', platform: 'iOS' }), null)
  assert.equal(db.find({ model: 'SM-A556B', manufacturer: 'Apple' }), null)

  // Compatible OEM manufacturer/sub-brand families and legacy image slugs resolve cleanly
  assert.equal(db.find({ model: 'SM-A556B', manufacturer: 'samsung' })?.brand, 'Samsung')
  assert.equal(db.find({ model: 'Nexus 5', manufacturer: 'Google' })?.marketName, 'Nexus 5')
  assert.equal(db.find({ model: 'Nexus_5.jpg' })?.marketName, 'Nexus 5')
  assert.equal(brandsMatch('HMD Global', 'Nokia'), true)
  assert.equal(brandsMatch('Motorola Mobility LLC', 'Lenovo'), true)
  assert.equal(brandsMatch('TCT (Alcatel)', 'TCL'), true)
  assert.equal(brandsMatch('Nothing', 'CMF by Nothing'), true)
  assert.equal(brandsMatch('ASUSTeK COMPUTER INC.', 'ASUS'), true)
  assert.equal(brandsMatch('vivo', 'iQOO'), true)
  assert.equal(brandsMatch('Samsung', 'Apple'), false)
})

test('generateDeviceSvg() produces valid XML across all 3 sizes, 5 form factors, and missing-DPI inputs', () => {
  const formFactorCases = [
    {
      expectedFormFactor: 'wearable',
      params: {
        model: 'SM-R890',
        brand: 'Samsung',
        width: 454,
        height: 454,
        xdpi: 424,
        ydpi: 424,
        sdk: 33
      }
    },
    {
      expectedFormFactor: 'foldable-tablet',
      params: {
        model: 'SM-F946B',
        brand: 'Samsung',
        width: 1812,
        height: 2176,
        xdpi: 373,
        ydpi: 373,
        sdk: 34
      }
    },
    {
      expectedFormFactor: 'legacy-16-9',
      params: {
        model: 'Nexus 5',
        name: 'hammerhead',
        width: 1080,
        height: 1920,
        xdpi: 445,
        ydpi: 445,
        sdk: 23
      }
    },
    {
      expectedFormFactor: 'modern-punch-hole',
      params: {
        model: 'Pixel 9',
        name: 'tokay',
        width: 1080,
        height: 2424,
        xdpi: 422,
        ydpi: 422,
        sdk: 34
      }
    },
    {
      expectedFormFactor: 'ultra-tall-21-9',
      params: {
        model: 'XQ-DQ54',
        brand: 'Sony',
        marketName: 'Xperia 1 V',
        width: 1644,
        height: 3840,
        xdpi: 643,
        ydpi: 643,
        sdk: 34
      }
    }
  ]

  const sizes = ['x24', 'x120', 'x800']

  for (const { expectedFormFactor, params } of formFactorCases) {
    for (const size of sizes) {
      const svg = generateDeviceSvg({ ...params, size })
      assertWellFormedSvg(svg, size)
      assert.ok(
        svg.includes(`data-form-factor="${expectedFormFactor}"`),
        `Expected form factor "${expectedFormFactor}" for size ${size}, got: ${svg}`
      )

      if (size === 'x24') {
        assert.equal(
          svg.includes('<text'),
          false,
          'x24 minimal badge must not contain tiny unreadable <text> elements'
        )
      } else {
        assert.ok(svg.includes('<text'), `${size} must include <text> metadata elements`)
      }
    }
  }

  // Missing DPI must not misclassify QHD+ phones as foldables or WVGA phones as wearables
  const qhdNoDpi = generateDeviceSvg({ model: 'SM-S928B', width: 1440, height: 3120, size: 'x24' })
  assert.ok(qhdNoDpi.includes('data-form-factor="modern-punch-hole"'))
  const wvgaNoDpi = generateDeviceSvg({ model: 'GT-I9100', width: 480, height: 800, size: 'x24' })
  assert.ok(wvgaNoDpi.includes('data-form-factor="legacy-16-9"'))

  // Memory-only x800 SVG renders memory details even without CPU name, and scopes gradient IDs
  const memOnlySvg = generateDeviceSvg({
    model: 'ProtoMem',
    brand: 'Samsung',
    memory: { ram: 8192, rom: 256 },
    size: 'x800'
  })
  assertWellFormedSvg(memOnlySvg, 'x800')
  assert.ok(memOnlySvg.includes('8192 MB RAM / 256 GB Storage'))
  assert.ok(memOnlySvg.includes('id="screenGrad-x800-'))
})

test('generateDeviceSvg() handles unknown prototype models, deterministic HSL colors, XML escaping, and data URIs', () => {
  const protoParams = {
    model: 'PROTO<X>&"1\'',
    brand: 'Lab & Co <Alpha>',
    width: 1080,
    height: 2400,
    xdpi: 400,
    ydpi: 400,
    size: 'x120'
  }

  const svg1 = generateDeviceSvg(protoParams)
  const svg2 = generateDeviceSvg(protoParams)
  assert.equal(svg1, svg2, 'SVG generation must be deterministic')
  assertWellFormedSvg(svg1, 'x120')
  assert.ok(svg1.includes('hsl('), 'SVG must use deterministic HSL brand colors')
  assert.equal(svg1.includes('Lab & Co <Alpha>'), false, 'Raw unescaped brand must not appear in XML')
  assert.ok(svg1.includes('Lab &amp; Co &lt;Alpha'), 'Escaped brand must appear in XML')

  const dataUri = getDeviceSvgDataUri(protoParams)
  assert.ok(dataUri.startsWith('data:image/svg+xml;utf8,'), 'Data URI must have svg+xml utf8 prefix')
  const decoded = decodeURIComponent(dataUri.slice('data:image/svg+xml;utf8,'.length))
  assert.equal(decoded, svg1)

  // Explicit marketName overrides DB marketName, image slug resolves DB entries, and iOS avoids Android SDK labels
  const customMarketSvg = generateDeviceSvg({
    image: 'SM-A556B.svg',
    model: 'SM-A556B',
    manufacturer: 'samsung',
    marketName: 'Lab A55 #3',
    size: 'x800'
  })
  assertWellFormedSvg(customMarketSvg, 'x800')
  assert.ok(customMarketSvg.includes('Samsung'))
  assert.ok(customMarketSvg.includes('Lab A55 #3'))

  const legacySlugSvg = generateDeviceSvg({ image: 'Nexus_5.jpg', size: 'x800' })
  assertWellFormedSvg(legacySlugSvg, 'x800')
  assert.ok(legacySlugSvg.includes('Nexus 5'))

  const iosSvg = generateDeviceSvg({
    image: 'iOS.jpg',
    model: 'iPhone16,2',
    marketName: 'iPhone 15 Pro Max',
    platform: 'iOS',
    width: 1290,
    height: 2796,
    sdk: 17,
    size: 'x800'
  })
  assertWellFormedSvg(iosSvg, 'x800')
  assert.ok(iosSvg.includes('Apple'))
  assert.ok(iosSvg.includes('iPhone 15 Pro Max'))
  assert.ok(iosSvg.includes('data-form-factor="modern-punch-hole"'))
  assert.equal(iosSvg.includes('Android SDK'), false)
})

test('pipeline parsers normalize dates, CPU, memory tiers, and cross-vendor guards accurately', () => {
  assert.deepEqual(
    parseCsvLine('"Samsung","Galaxy ""S""","galaxys","GT-I9000"'),
    ['Samsung', 'Galaxy "S"', 'galaxys', 'GT-I9000']
  )
  assert.equal(normalizeBrandMarketKey('Samsung', 'Samsung Galaxy S24'), 'samsung galaxy s24')
  assert.equal(normalizeDate('2023-08'), '2023-08-01')
  assert.equal(normalizeDate('2023-10-04T00:00:00Z'), '2023-10-04')
  assert.equal(parseCores('2+4'), 6)
  assert.equal(parseCores("'8'"), 8)
  assert.equal(parseFreq('1 x 3.0 GHz + 3 x 2.5 GHz + 4 x 1.80 GHz'), 3)
  assert.equal(parseFreq('1x2.84 GHz + 3x2.42 GHz + 4x1.78 GHz'), 2.84)
  assert.equal(parseFreq('1 x 2,84 GHz + 3 x 2,42 GHz + 4 x 1,80 GHz'), 2.84)
  assert.equal(parseFreq('1200 MHz'), 1.2)
  assert.equal(parseRamMb('4/6 GB LPDDR4X'), 4096)
  assert.equal(parseRamMb('512 MB'), 512)
  assert.equal(parseRamMb('512 MB / 1 GB'), 512)
  assert.equal(parseRamMb('512/1 GB'), 512)
  assert.equal(parseStorageGb('64/128 GB UFS 2.1'), 64)
  assert.equal(parseStorageGb('256/512/1 TB'), 256)
  assert.equal(parseStorageGb('1/2 TB'), 1024)
  assert.equal(brandsAreCompatible('Xiaomi', 'Redmi'), true)
  assert.equal(brandsAreCompatible('LGE', 'LG'), true)
  assert.equal(brandsAreCompatible('Google', 'Deutsche Telekom'), false)

  const models = {
    hummer: { b: 'NOA Mobile', m: 'Hummer', d: null, c: null, y: null }
  }
  const codenames = {
    hummer: { b: 'NOA Mobile', m: 'Hummer', d: null, c: null, y: null }
  }
  const codenameToModels = new Map([['hummer', new Set(['hummer'])]])
  applyLineageDoc(
    {
      vendor: 'OnePlus',
      name: 'Ace 5 Pro',
      codename: 'hummer',
      models: ['PKR110'],
      release: '2024-12',
      soc: 'Qualcomm SM8750 Snapdragon 8 Elite',
      cpu_cores: '8',
      cpu_freq: '2 x 4.32 GHz + 6 x 3.53 GHz',
      ram: '12/16 GB',
      storage: '256/512/1 TB'
    },
    models,
    codenames,
    codenameToModels
  )
  // Unrelated vendor model must remain untouched
  assert.equal(models.hummer.b, 'NOA Mobile')
  assert.equal(models.hummer.c, null)
  // LineageOS codename & explicit model get accurate OnePlus specs
  assert.equal(codenames.hummer.b, 'OnePlus')
  assert.equal(codenames.hummer.y.rom, 256)
  assert.equal(models.pkr110.b, 'OnePlus')
  assert.equal(models.pkr110.y.rom, 256)
})

test('LineageOS specs reach a device that Play lists under its maker and LineageOS under its seller', () => {
  const models = {
    'nexus 5': { b: 'LGE', m: 'Nexus 5', d: null, c: null, y: null }
  }
  const codenames = {
    hammerhead: { b: 'LGE', m: 'Nexus 5', d: null, c: null, y: null }
  }
  const codenameToModels = new Map([['hammerhead', new Set(['nexus 5'])]])
  applyLineageDoc(
    {
      vendor: 'Google',
      name: 'Nexus 5',
      codename: 'hammerhead',
      release: '2013-10-31',
      soc: 'Qualcomm MSM8974 Snapdragon 800',
      cpu_cores: '4',
      cpu_freq: '2.26 GHz',
      ram: '2 GB',
      storage: '16/32 GB'
    },
    models,
    codenames,
    codenameToModels
  )
  assert.equal(models['nexus 5'].b, 'LGE')
  assert.equal(models['nexus 5'].d, '2013-10-31')
  assert.equal(models['nexus 5'].c.cores, 4)
  assert.equal(codenames.hammerhead.b, 'LGE')
  assert.equal(codenames.hammerhead.y.ram, 2048)

  const nexus5 = find({ model: 'Nexus 5', name: 'hammerhead' })
  assert.equal(nexus5.brand, 'LGE')
  assert.equal(nexus5.date, '2013-10-31')
  assert.equal(nexus5.cpu.name, 'Qualcomm MSM8974 Snapdragon 800')
})

test('an identical model name alone does not tie devices of different brands', () => {
  const models = {
    thor: { b: 'QUBO', m: 'THOR', d: null, c: null, y: null }
  }
  applyLineageDoc(
    { vendor: 'AYN', name: 'Thor', codename: 'odin2thor', models: ['Thor'], soc: 'Qualcomm QCS8550' },
    models,
    {},
    new Map()
  )
  assert.equal(models.thor.b, 'QUBO')
  assert.equal(models.thor.c, null)
})
