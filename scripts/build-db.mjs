import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../dist')
const OUTPUT_FILE = path.join(DIST_DIR, 'devices.json')

const PLAY_CSV_URL = 'https://storage.googleapis.com/play_public/supported_devices.csv'
const LINEAGE_TAR_URL = 'https://codeload.github.com/LineageOS/lineage_wiki/tar.gz/refs/heads/main'
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql?format=json'
const USER_AGENT = 'DeviceFarmer-stf-device-db/2.0.0 (https://github.com/DeviceFarmer/stf-device-db; contact@devicefarmer.com)'

const BRAND_FAMILY_MAP = new Map([
  ['lg', 'lg'],
  ['lge', 'lg'],
  ['lg electronics', 'lg'],
  ['xiaomi', 'xiaomi'],
  ['redmi', 'xiaomi'],
  ['poco', 'xiaomi'],
  ['blackshark', 'xiaomi'],
  ['black shark', 'xiaomi'],
  ['huawei', 'huawei'],
  ['honor', 'huawei'],
  ['zte', 'zte'],
  ['nubia', 'zte'],
  ['redmagic', 'zte'],
  ['red magic', 'zte'],
  ['lenovo', 'lenovo'],
  ['motorola', 'lenovo'],
  ['zuk', 'lenovo'],
  ['tct', 'tcl'],
  ['tct alcatel', 'tcl'],
  ['alcatel', 'tcl'],
  ['tcl', 'tcl'],
  ['nokia', 'nokia'],
  ['hmd', 'nokia'],
  ['hmd global', 'nokia'],
  ['vivo', 'vivo'],
  ['iqoo', 'vivo'],
  ['oppo', 'oppo'],
  ['oneplus', 'oppo'],
  ['realme', 'oppo'],
  ['nothing', 'nothing'],
  ['cmf', 'nothing'],
  ['cmf by nothing', 'nothing'],
  ['asus', 'asus'],
  ['asustek', 'asus'],
  ['sony', 'sony'],
  ['somc', 'sony'],
  ['f x tec', 'fxtec'],
  ['fxtec', 'fxtec'],
  ['barnes noble', 'bn'],
  ['barnes and noble', 'bn'],
  ['bn', 'bn'],
  ['ark', 'ark'],
  ['ark benefit', 'ark']
])

// Stock Google Nexus 7 product names (ro.product.name) mapped to hardware codenames (ro.product.device)
const PRODUCT_CODENAME_ALIASES = [
  ['nakasi', 'grouper'],
  ['nakasig', 'tilapia'],
  ['razor', 'flo'],
  ['razorg', 'deb']
]

export function canonicalizeBrand(brand) {
  const norm = String(brand || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!norm) return ''
  if (BRAND_FAMILY_MAP.has(norm)) return BRAND_FAMILY_MAP.get(norm)
  const firstWord = norm.split(' ')[0]
  if (
    firstWord &&
    BRAND_FAMILY_MAP.has(firstWord) &&
    (firstWord === 'motorola' ||
      firstWord === 'tct' ||
      firstWord === 'tcl' ||
      firstWord === 'alcatel' ||
      firstWord === 'hmd' ||
      firstWord === 'nokia' ||
      firstWord === 'asus' ||
      firstWord === 'asustek' ||
      firstWord === 'sony' ||
      firstWord === 'realme' ||
      firstWord === 'cmf')
  ) {
    return BRAND_FAMILY_MAP.get(firstWord)
  }
  return norm
}

export function brandsAreCompatible(brandA, brandB) {
  const a = canonicalizeBrand(brandA)
  const b = canonicalizeBrand(brandB)
  if (!a || !b) return true
  if (a === b) return true
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b + ' ') || b.startsWith(a + ' '))) {
    return true
  }
  return false
}

function unwrapYamlScalar(raw) {
  if (raw === null || raw === undefined) return null
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const val = typeof item === 'object' && item !== null ? Object.values(item)[0] : item
      const unwrapped = unwrapYamlScalar(val)
      if (unwrapped !== null && unwrapped !== '') return unwrapped
    }
    return null
  }
  if (typeof raw === 'object') {
    const values = Object.values(raw)
    return values.length > 0 ? unwrapYamlScalar(values[0]) : null
  }
  return raw
}

async function fetchWithRetry(url, init, fetchImpl = fetch, maxAttempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const requestInit = fetchImpl === fetch
        ? { ...init, signal: AbortSignal.timeout(60_000) }
        : init
      const res = await fetchImpl(url, requestInit)
      if (res.ok) return res
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000))
        continue
      }
      throw lastError
    }
  }
  throw lastError
}

export function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current.trim())
  return fields
}

export function normalizeBrandMarketKey(brand, marketName) {
  const b = (brand || '').trim().toLowerCase()
  let m = (marketName || '').trim().toLowerCase()
  if (b && (m === b || m.startsWith(b + ' '))) {
    m = m.slice(b.length).trim()
  }
  const combined = b ? `${b} ${m}` : m
  return combined.replace(/[^a-z0-9]+/g, ' ').trim()
}

export function normalizeDate(raw) {
  if (!raw) return null
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const val = typeof item === 'object' && item !== null ? Object.values(item)[0] : item
      const parsed = normalizeDate(val)
      if (parsed) return parsed
    }
    return null
  }
  if (typeof raw === 'object') {
    return normalizeDate(Object.values(raw)[0])
  }
  const str = String(raw).trim()
  const fullMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (fullMatch) {
    return `${fullMatch[1]}-${fullMatch[2]}-${fullMatch[3]}`
  }
  const ymMatch = str.match(/^(\d{4})-(\d{2})$/)
  if (ymMatch) {
    return `${ymMatch[1]}-${ymMatch[2]}-01`
  }
  const yMatch = str.match(/^(\d{4})$/)
  if (yMatch) {
    return `${yMatch[1]}-01-01`
  }
  return null
}

export function parseCores(raw) {
  const unwrapped = unwrapYamlScalar(raw)
  if (unwrapped === null || unwrapped === undefined) return null
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) return unwrapped
  const str = String(unwrapped).trim()
  if (!str) return null
  if (str.includes('+')) {
    const parts = str.split('+').map(p => parseInt(p.trim(), 10)).filter(Number.isFinite)
    if (parts.length > 0) return parts.reduce((a, b) => a + b, 0)
  }
  const m = str.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

export function parseFreq(raw) {
  const unwrapped = unwrapYamlScalar(raw)
  if (unwrapped === null || unwrapped === undefined) return null
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) return unwrapped
  const str = String(unwrapped).trim().replace(/(\d),(\d)/g, '$1.$2')
  if (!str) return null

  let maxFreq = null
  const unitMatches = [...str.matchAll(/(\d+(?:\.\d+)?)\s*(GHz|MHz)\b/gi)]
  if (unitMatches.length > 0) {
    for (const match of unitMatches) {
      const val = parseFloat(match[1])
      const unit = match[2].toUpperCase()
      if (!Number.isFinite(val) || val <= 0) continue
      const ghz = unit === 'MHZ' || val > 100 ? +(val / 1000).toFixed(2) : val
      if (ghz > 0 && ghz <= 10 && (maxFreq === null || ghz > maxFreq)) {
        maxFreq = ghz
      }
    }
    return maxFreq
  }

  // Fallback for unitless strings (e.g. "2.26" or "1500"): strip core multipliers like "4x" / "4 x "
  const withoutMultipliers = str.replace(/\b\d+\s*[x×]\s*/gi, '')
  for (const match of withoutMultipliers.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const val = parseFloat(match[1])
    if (!Number.isFinite(val) || val <= 0) continue
    const ghz = val > 100 ? +(val / 1000).toFixed(2) : val
    if (ghz > 0 && ghz <= 10 && (maxFreq === null || ghz > maxFreq)) {
      maxFreq = ghz
    }
  }
  return maxFreq
}

function parseFirstTierWithUnit(str, defaultUnit) {
  // Match leading tier group like "256/512/1 TB", "512 MB / 1 GB", "64/128 GB UFS 2.1"
  const firstMatch = str.match(/(\d+(?:\.\d+)?)\s*(MB|GB|TB)?/i)
  if (!firstMatch) return null
  const firstVal = parseFloat(firstMatch[1])
  if (!Number.isFinite(firstVal) || firstVal <= 0) return null

  if (firstMatch[2]) {
    return { val: firstVal, unit: firstMatch[2].toUpperCase() }
  }

  // Walk subsequent "/ <num> [unit]" tiers until the first explicit unit
  const rest = str.slice(firstMatch.index + firstMatch[0].length)
  const tierRegex = /^\s*(?:\/|,|\bor\b)\s*(\d+(?:\.\d+)?)\s*(MB|GB|TB)?/i
  let cursor = rest
  let prevVal = firstVal
  let unitStepDrops = 0
  let resolvedUnit = null

  while (cursor) {
    const m = cursor.match(tierRegex)
    if (!m) break
    const nextVal = parseFloat(m[1])
    if (Number.isFinite(nextVal) && prevVal >= 64 && nextVal <= 16) {
      unitStepDrops++
    }
    prevVal = nextVal
    if (m[2]) {
      resolvedUnit = m[2].toUpperCase()
      break
    }
    cursor = cursor.slice(m[0].length)
  }

  let unit = resolvedUnit || defaultUnit
  const units = ['MB', 'GB', 'TB']
  if (unitStepDrops > 0) {
    const idx = units.indexOf(unit)
    if (idx > 0) {
      unit = units[Math.max(0, idx - unitStepDrops)]
    }
  }

  return { val: firstVal, unit }
}

export function parseRamMb(raw) {
  const unwrapped = unwrapYamlScalar(raw)
  if (unwrapped === null || unwrapped === undefined) return null
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    return unwrapped <= 64 ? Math.round(unwrapped * 1024) : Math.round(unwrapped)
  }
  const str = String(unwrapped).trim()
  if (!str) return null
  const parsed = parseFirstTierWithUnit(str, 'GB')
  if (!parsed) return null

  let { val, unit } = parsed
  // Sanity guard: smartphone/tablet RAM >= 128 without explicit MB is already in MB
  if (unit === 'GB' && val >= 128) unit = 'MB'
  if (unit === 'TB') return Math.round(val * 1024 * 1024)
  if (unit === 'MB') return Math.round(val)
  return Math.round(val * 1024)
}

export function parseStorageGb(raw) {
  const unwrapped = unwrapYamlScalar(raw)
  if (unwrapped === null || unwrapped === undefined) return null
  if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) {
    return unwrapped
  }
  const str = String(unwrapped).trim()
  if (!str) return null
  const parsed = parseFirstTierWithUnit(str, 'GB')
  if (!parsed) return null

  let { val, unit } = parsed
  // Sanity guard: no mobile device has >= 32 TB storage
  if (unit === 'TB' && val >= 32) unit = 'GB'
  if (unit === 'MB') return +(val / 1024).toFixed(2)
  if (unit === 'TB') return Math.round(val * 1024)
  return val
}

function decodeCsvBuffer(buf) {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf)
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf)
  }
  return new TextDecoder('utf-8').decode(buf)
}

export async function fetchPlayDevices(fetchImpl = fetch) {
  const res = await fetchWithRetry(
    PLAY_CSV_URL,
    { headers: { 'User-Agent': USER_AGENT } },
    fetchImpl
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Play CSV: ${res.status} ${res.statusText}`)
  }
  const buf = await res.arrayBuffer()
  const text = decodeCsvBuffer(buf)
  const lines = text.split(/\r?\n/)

  const models = Object.create(null)
  const codenames = Object.create(null)
  const codenameToModels = new Map()
  const codenameCandidates = new Map()
  const modelDistinctIdentities = new Map()

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const [brandRaw, marketNameRaw, deviceRaw, modelRaw] = parseCsvLine(line)
    const brand = (brandRaw || '').trim()
    const device = (deviceRaw || '').trim()
    const model = (modelRaw || '').trim()
    const marketName = (marketNameRaw || '').trim() || model || device

    if (!model && !device) continue

    const entry = {
      b: brand,
      m: marketName,
      d: null,
      c: null,
      y: null
    }

    if (model) {
      const mKey = model.toLowerCase()
      const identityKey = normalizeBrandMarketKey(canonicalizeBrand(brand), marketName)
      if (identityKey) {
        if (!modelDistinctIdentities.has(mKey)) {
          modelDistinctIdentities.set(mKey, new Set())
        }
        modelDistinctIdentities.get(mKey).add(identityKey)
      }

      if (!models[mKey] || (!models[mKey].m && marketName)) {
        models[mKey] = entry
      }
      if (device) {
        const dKey = device.toLowerCase()
        if (!codenameToModels.has(dKey)) {
          codenameToModels.set(dKey, new Set())
        }
        codenameToModels.get(dKey).add(mKey)
      }
    }

    if (device) {
      const dKey = device.toLowerCase()
      if (!codenameCandidates.has(dKey)) {
        codenameCandidates.set(dKey, new Map())
      }
      const byIdentity = codenameCandidates.get(dKey)
      const candKey = `${canonicalizeBrand(brand)}::${marketName.toLowerCase()}`
      const existing = byIdentity.get(candKey)
      if (existing) {
        existing.count++
      } else {
        byIdentity.set(candKey, { count: 1, entry: { ...entry } })
      }
    }
  }

  // Pick the dominant SKU candidate for each codename
  for (const [dKey, byIdentity] of codenameCandidates.entries()) {
    let best = null
    for (const cand of byIdentity.values()) {
      if (!best || cand.count > best.count) {
        best = cand
      }
    }
    if (best) {
      codenames[dKey] = { ...best.entry }
      // Attach alternate Play candidates (non-enumerable) so LineageOS merge can match exact vendor
      if (byIdentity.size > 1) {
        Object.defineProperty(codenames[dKey], '_playAlts', {
          value: [...byIdentity.values()].map(v => v.entry),
          enumerable: false
        })
      }
    }
  }

  // Mark models shared across multiple distinct devices (e.g. "Nexus 7" 2012 vs 2013)
  for (const [mKey, identities] of modelDistinctIdentities.entries()) {
    if (identities.size > 1 && models[mKey]) {
      models[mKey].a = 1
    }
  }

  return { models, codenames, codenameToModels }
}

export function extractTarGzYmlEntries(tarStream) {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip()
    const chunks = []

    gunzip.on('data', chunk => chunks.push(chunk))
    gunzip.on('error', reject)
    gunzip.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks)
        const files = []
        let offset = 0
        let paxPath = null

        while (offset + 512 <= buffer.length) {
          const header = buffer.subarray(offset, offset + 512)
          if (header[0] === 0) {
            offset += 512
            continue
          }

          const baseName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
          const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
          const sizeStr = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
          const size = parseInt(sizeStr, 8) || 0
          const typeFlag = String.fromCharCode(header[156])

          offset += 512

          if (offset + size > buffer.length) {
            throw new Error(`Truncated tar entry "${paxPath || baseName}" (expected ${size} bytes)`)
          }

          if (typeFlag === 'x' || typeFlag === 'L') {
            const rawPax = buffer.subarray(offset, offset + size).toString('utf8')
            if (typeFlag === 'L') {
              paxPath = rawPax.replace(/\0.*$/, '')
            } else {
              const pathMatch = rawPax.match(/\d+ path=(.+)\n/)
              if (pathMatch) paxPath = pathMatch[1]
            }
          } else if (typeFlag === '0' || typeFlag === '\0') {
            const name = paxPath || (prefix ? `${prefix}/${baseName}` : baseName)
            paxPath = null
            if (name.includes('_data/devices/') && (name.endsWith('.yml') || name.endsWith('.yaml'))) {
              const content = buffer.subarray(offset, offset + size).toString('utf8')
              files.push({ name, content })
            }
          } else {
            paxPath = null
          }

          offset += Math.ceil(size / 512) * 512
        }
        resolve(files)
      } catch (err) {
        reject(err)
      }
    })

    if (typeof tarStream.pipe === 'function') {
      tarStream.pipe(gunzip)
    } else if (tarStream instanceof ReadableStream) {
      const reader = tarStream.getReader()
      const pump = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            gunzip.end()
            return
          }
          gunzip.write(Buffer.from(value))
          pump()
        }).catch(err => gunzip.destroy(err))
      }
      pump()
    } else {
      reject(new Error('Unsupported stream type'))
    }
  })
}

export function applyLineageDoc(doc, models, codenames, codenameToModels = new Map()) {
  if (!doc || typeof doc !== 'object') return

  const date = normalizeDate(doc.release)
  const rawSoc = unwrapYamlScalar(doc.soc)
  const soc = rawSoc ? String(rawSoc).trim() : null
  const cores = parseCores(doc.cpu_cores)
  const freq = parseFreq(doc.cpu_freq)
  const ram = parseRamMb(doc.ram)
  const rom = parseStorageGb(doc.storage)

  const cpu = (soc !== null || cores !== null || freq !== null)
    ? { name: soc, cores, freq }
    : null
  const memory = (ram !== null || rom !== null)
    ? { ram, rom }
    : null

  const rawVendor = unwrapYamlScalar(doc.vendor)
  const rawName = unwrapYamlScalar(doc.name)
  const vendor = rawVendor ? String(rawVendor).trim() : ''
  const name = rawName ? String(rawName).trim() : ''
  const codename = doc.codename ? String(doc.codename).trim() : ''
  const modelList = Array.isArray(doc.models)
    ? doc.models.map(m => String(m).trim()).filter(Boolean)
    : []

  const mergeInto = (target, fallbackMarket) => {
    if (!target.b && vendor) target.b = vendor
    if (!target.m && (name || fallbackMarket)) target.m = name || fallbackMarket
    if (date && !target.d) target.d = date
    if (cpu) {
      target.c = target.c || { name: null, cores: null, freq: null }
      if (cpu.name && !target.c.name) target.c.name = cpu.name
      if (cpu.cores !== null && target.c.cores === null) target.c.cores = cpu.cores
      if (cpu.freq !== null && target.c.freq === null) target.c.freq = cpu.freq
    }
    if (memory) {
      target.y = target.y || { ram: null, rom: null }
      if (memory.ram !== null && target.y.ram === null) target.y.ram = memory.ram
      if (memory.rom !== null && target.y.rom === null) target.y.rom = memory.rom
    }
  }

  if (codename) {
    const cKey = codename.toLowerCase()
    const existingCode = codenames[cKey]

    if (!existingCode) {
      codenames[cKey] = { b: vendor, m: name || codename, d: null, c: null, y: null }
      mergeInto(codenames[cKey], codename)
    } else if (brandsAreCompatible(existingCode.b, vendor)) {
      mergeInto(existingCode, codename)
    } else {
      // Existing Play codename belonged to a different vendor; look for a matching-vendor Play entry or replace with LineageOS
      const playAlts = existingCode._playAlts || []
      const matchingAlt = playAlts.find(alt => brandsAreCompatible(alt.b, vendor))
      codenames[cKey] = matchingAlt
        ? { ...matchingAlt }
        : { b: vendor, m: name || codename, d: null, c: null, y: null }
      mergeInto(codenames[cKey], codename)
    }

    const mappedModels = codenameToModels.get(cKey)
    if (mappedModels) {
      for (const mKey of mappedModels) {
        const targetModel = models[mKey]
        if (!targetModel) continue
        if (!brandsAreCompatible(targetModel.b, vendor)) continue
        // Do not pollute ambiguous multi-generation model keys (e.g. "Nexus 7") with one generation's specs
        if (targetModel.a) continue
        mergeInto(targetModel, mKey)
      }
    }
  }

  for (const mod of modelList) {
    const mKey = mod.toLowerCase()
    const existingModel = models[mKey]
    if (!existingModel) {
      models[mKey] = { b: vendor, m: name || mod, d: null, c: null, y: null }
      mergeInto(models[mKey], mod)
    } else if (brandsAreCompatible(existingModel.b, vendor) && !existingModel.a) {
      mergeInto(existingModel, mod)
    }
  }
}

export async function mergeLineageWiki(models, codenames, fetchImpl = fetch, codenameToModels = new Map()) {
  const res = await fetchWithRetry(
    LINEAGE_TAR_URL,
    { headers: { 'User-Agent': USER_AGENT } },
    fetchImpl
  )
  if (!res.ok) {
    throw new Error(`Failed to fetch LineageOS wiki tarball: ${res.status} ${res.statusText}`)
  }
  const files = await extractTarGzYmlEntries(res.body)
  files.sort((a, b) => a.name.localeCompare(b.name))

  for (const file of files) {
    try {
      const doc = YAML.parse(file.content)
      applyLineageDoc(doc, models, codenames, codenameToModels)
    } catch {
      // Ignore malformed YAML files if any
    }
  }

  // Populate stock product-name aliases (e.g. nakasi -> grouper, razor -> flo)
  for (const [alias, target] of PRODUCT_CODENAME_ALIASES) {
    if (!codenames[alias] && codenames[target]) {
      codenames[alias] = { ...codenames[target] }
    }
  }
}

export async function mergeWikidataDates(models, codenames, fetchImpl = fetch) {
  const sparql = `
SELECT ?itemLabel ?manufacturerLabel ?pubDate WHERE {
  VALUES ?type { wd:Q19723451 wd:Q17517 wd:Q155972 }
  ?item wdt:P31 ?type ;
        wdt:P577 ?pubDate .
  OPTIONAL { ?item wdt:P176 ?manufacturer . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`.trim()

  const url = `${WIKIDATA_SPARQL_URL}&query=${encodeURIComponent(sparql)}`
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/sparql-results+json'
      }
    },
    fetchImpl
  )

  if (!res.ok) {
    throw new Error(`Failed to query Wikidata SPARQL: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const bindings = data?.results?.bindings || []
  const dateMap = new Map()

  for (const row of bindings) {
    const label = row.itemLabel?.value || ''
    if (!label || /^Q\d+$/.test(label)) continue
    const cleanLabel = label.replace(/\s+smartphone$/i, '').trim()
    const brand = row.manufacturerLabel?.value || ''
    const date = normalizeDate(row.pubDate?.value)
    if (!date) continue

    const keys = [
      normalizeBrandMarketKey(brand, cleanLabel),
      normalizeBrandMarketKey(canonicalizeBrand(brand), cleanLabel),
      // If P176 manufacturer was omitted on Wikidata, cleanLabel itself often starts with the brand (e.g. "Samsung Galaxy S24")
      !brand ? normalizeBrandMarketKey('', cleanLabel) : ''
    ].filter(Boolean)

    for (const k of keys) {
      const existing = dateMap.get(k)
      if (!existing || date < existing) {
        dateMap.set(k, date)
      }
    }
  }

  const applyDates = (mapObj) => {
    for (const entry of Object.values(mapObj)) {
      if (entry.d || entry.a) continue
      const k1 = normalizeBrandMarketKey(entry.b, entry.m)
      const k2 = normalizeBrandMarketKey(canonicalizeBrand(entry.b), entry.m)
      const matched = (k1 && dateMap.get(k1)) || (k2 && dateMap.get(k2))
      if (matched) {
        entry.d = matched
      }
    }
  }

  applyDates(models)
  applyDates(codenames)
}

export function sortRecord(obj) {
  const sorted = Object.create(null)
  for (const key of Object.keys(obj).sort()) {
    const e = obj[key]
    const compact = {
      b: e.b || '',
      m: e.m || key
    }
    if (e.d) compact.d = e.d
    if (e.c) compact.c = e.c
    if (e.y) compact.y = e.y
    if (e.a) compact.a = 1
    sorted[key] = compact
  }
  return sorted
}

export async function buildDatabase(options = {}) {
  const fetchImpl = options.fetch || fetch
  const outputPath = options.outputPath || OUTPUT_FILE

  const { models, codenames, codenameToModels } = await fetchPlayDevices(fetchImpl)
  await mergeLineageWiki(models, codenames, fetchImpl, codenameToModels)
  await mergeWikidataDates(models, codenames, fetchImpl)

  const db = {
    models: sortRecord(models),
    codenames: sortRecord(codenames)
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(db) + '\n', 'utf8')
  return db
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildDatabase()
    .then(db => {
      console.log(
        `Built dist/devices.json with ${Object.keys(db.models).length} models and ${Object.keys(db.codenames).length} codenames.`
      )
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
