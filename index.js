const data = require('./dist/devices.json')
const { canonicalBrand, brandsMatch } = require('./brands')

const FALLBACK_IMAGE = 'generic-phone-v1.svg'

const XML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}

const modelKeysCache = Object.keys(data.models)

function hasOwn(obj, key) {
  return Boolean(obj && typeof obj === 'object' && Object.hasOwn(obj, key))
}

function entryMatchesBrand(rawBrand, entry) {
  if (!rawBrand || !entry || !entry.b) return true
  if (brandsMatch(rawBrand, entry.b)) return true
  if (canonicalBrand(rawBrand) === 'google' && entry.m && /\bnexus\b/i.test(entry.m)) {
    return true
  }
  return false
}

function escapeXml(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, ch => XML_ENTITIES[ch])
}

function hashBrandHue(brand) {
  const str = String(brand || 'DeviceFarmer').trim().toLowerCase() || 'devicefarmer'
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 360
}

function getBrandPalette(brand) {
  const hue = hashBrandHue(brand)
  const secondaryHue = (hue + 28) % 360
  return {
    hue,
    primary: `hsl(${hue}, 68%, 52%)`,
    secondary: `hsl(${secondaryHue}, 64%, 38%)`,
    accent: `hsl(${hue}, 82%, 68%)`,
    surface: `hsl(${hue}, 26%, 16%)`,
    chassis: `hsl(${hue}, 22%, 22%)`,
    border: `hsl(${hue}, 38%, 44%)`
  }
}

function makeImageToken(id) {
  if (!id) return FALLBACK_IMAGE
  const slug = String(id)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug || /^\.+$/.test(slug)) return FALLBACK_IMAGE
  return slug.toLowerCase().endsWith('.svg') ? slug : `${slug}.svg`
}

function hasBrandPrefix(brand, marketName) {
  if (!brand || !marketName) return false
  const lb = brand.toLowerCase()
  const lm = marketName.toLowerCase()
  return (
    lm === lb ||
    lm.startsWith(lb + ' ') ||
    lm.startsWith(lb + '-') ||
    lm.startsWith(lb + '_')
  )
}

function formatRecord(entry, fallbackId, imageStem) {
  const brand = entry.b || ''
  const marketName = entry.m || fallbackId || ''
  const id = marketName
  const long = brand && marketName && !hasBrandPrefix(brand, marketName)
    ? `${brand} ${marketName}`
    : (marketName || brand)

  return {
    name: {
      id,
      long
    },
    brand,
    marketName,
    date: entry.d || null,
    cpu: entry.c
      ? {
          name: entry.c.name ?? null,
          cores: entry.c.cores ?? null,
          freq: entry.c.freq ?? null
        }
      : null,
    memory: entry.y
      ? {
          ram: entry.y.ram ?? null,
          rom: entry.y.rom ?? null
        }
      : null,
    image: entry.i || makeImageToken(imageStem || id)
  }
}

function enrichEntry(primary, secondary) {
  if (!secondary || !brandsMatch(primary.b, secondary.b)) {
    return primary
  }
  return {
    b: primary.b || secondary.b,
    m: primary.m || secondary.m,
    d: primary.d || secondary.d || null,
    c: primary.c || secondary.c || null,
    y: primary.y || secondary.y || null
  }
}

function stripImageExtension(value) {
  return String(value || '')
    .trim()
    .replace(/\.(?:svg|jpe?g|png|webp)$/i, '')
    .trim()
}

function candidateKeys(raw) {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  const out = []
  const pushUnique = (val) => {
    const k = val.trim().toLowerCase()
    if (k && k !== 'generic-phone-v1' && !out.includes(k)) {
      out.push(k)
    }
  }
  pushUnique(trimmed)
  const stem = stripImageExtension(trimmed)
  if (stem && stem !== trimmed) {
    pushUnique(stem)
  }
  if (stem.includes('_')) {
    pushUnique(stem.replace(/_/g, ' '))
  }
  return out
}

function find(properties) {
  if (!properties || typeof properties !== 'object') {
    return null
  }

  const rawPlatform = typeof properties.platform === 'string' ? properties.platform.trim().toLowerCase() : ''
  if (rawPlatform && rawPlatform !== 'android') {
    return null
  }

  const rawModel = typeof properties.model === 'string' ? properties.model.trim() : ''
  const rawName = typeof properties.name === 'string' ? properties.name.trim() : ''
  const rawBrand = typeof properties.brand === 'string' && properties.brand.trim()
    ? properties.brand.trim()
    : (typeof properties.manufacturer === 'string' ? properties.manufacturer.trim() : '')

  const modelCandidates = candidateKeys(rawModel)
  const nameCandidates = candidateKeys(rawName)

  let codeByName = null
  let matchedNameRaw = rawName
  for (const nk of nameCandidates) {
    if (hasOwn(data.codenames, nk)) {
      codeByName = data.codenames[nk]
      matchedNameRaw = stripImageExtension(rawName) || rawName
      break
    }
  }

  for (const modelKey of modelCandidates) {
    const stemForImage = stripImageExtension(rawModel) || rawModel
    if (hasOwn(data.models, modelKey)) {
      const match = data.models[modelKey]
      // If model is shared across multiple distinct devices (e.g. "Nexus 7"), disambiguate via codename
      if (
        match.a &&
        codeByName &&
        entryMatchesBrand(rawBrand, codeByName) &&
        (brandsMatch(match.b, codeByName.b) || (codeByName.m && codeByName.m.toLowerCase().includes(modelKey)))
      ) {
        return formatRecord(codeByName, matchedNameRaw, matchedNameRaw)
      }
      if (entryMatchesBrand(rawBrand, match)) {
        const compatibleSecondary = codeByName && entryMatchesBrand(rawBrand, codeByName) ? codeByName : null
        const enriched = enrichEntry(match, compatibleSecondary)
        return formatRecord(enriched, stemForImage, stemForImage)
      }
    }
    if (hasOwn(data.codenames, modelKey)) {
      const codeMatch = data.codenames[modelKey]
      if (entryMatchesBrand(rawBrand, codeMatch)) {
        return formatRecord(codeMatch, stemForImage, stemForImage)
      }
    }
  }

  for (const nameKey of nameCandidates) {
    const stemForImage = stripImageExtension(rawName) || rawName
    if (hasOwn(data.codenames, nameKey)) {
      const cm = data.codenames[nameKey]
      if (entryMatchesBrand(rawBrand, cm)) {
        return formatRecord(cm, stemForImage, stemForImage)
      }
    }
    if (hasOwn(data.models, nameKey)) {
      const mm = data.models[nameKey]
      if (entryMatchesBrand(rawBrand, mm)) {
        return formatRecord(mm, stemForImage, stemForImage)
      }
    }
  }

  return null
}

function sample() {
  if (modelKeysCache.length === 0) {
    return {
      model: 'Nexus 5',
      name: { id: 'Nexus 5', long: 'LGE Nexus 5' },
      brand: 'LGE',
      marketName: 'Nexus 5',
      date: '2013-10-31',
      cpu: null,
      memory: null,
      image: 'Nexus_5.svg'
    }
  }
  const key = modelKeysCache[Math.floor(Math.random() * modelKeysCache.length)]
  const entry = data.models[key]
  const record = formatRecord(entry, key, key)
  const displayModel = /^[a-z0-9-]+$/.test(key) && /\d/.test(key) ? key.toUpperCase() : (record.marketName || key)
  return {
    model: displayModel,
    ...record
  }
}

function normalizeDpiScalar(raw) {
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return NaN
  // Convert Android DisplayMetrics.density scale factors (e.g. 2.0, 2.75, 3.0) to approximate DPI
  return num <= 10 ? num * 160 : num
}

function computeDisplayMetrics(params = {}, isIos = false) {
  const display = (params && typeof params.display === 'object' && params.display) || params || {}
  const rawWidth = Number(params.width ?? display.width)
  const rawHeight = Number(params.height ?? display.height)
  const fallbackDpi = normalizeDpiScalar(params.dpi ?? display.dpi)
  const rawXdpi = Number(params.xdpi ?? display.xdpi ?? fallbackDpi)
  const rawYdpi = Number(params.ydpi ?? display.ydpi ?? fallbackDpi)
  const rawSdk = isIos ? NaN : Number(params.sdk ?? params.sdkVersion ?? (params.version && params.version.sdk))
  const rawInches = Number(
    params.inches ??
    params.diagonal ??
    display.inches ??
    display.diagonal ??
    (params.display && typeof params.display === 'object' ? params.display.size : NaN)
  )

  const hasExplicitDpi = (Number.isFinite(rawXdpi) && rawXdpi > 0) || (Number.isFinite(rawYdpi) && rawYdpi > 0)
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1080
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 2400
  const xdpi = Number.isFinite(rawXdpi) && rawXdpi > 0 ? rawXdpi : (Number.isFinite(rawYdpi) && rawYdpi > 0 ? rawYdpi : 400)
  const ydpi = Number.isFinite(rawYdpi) && rawYdpi > 0 ? rawYdpi : xdpi
  const sdk = Number.isFinite(rawSdk) && rawSdk > 0 ? rawSdk : null

  const shortPx = Math.min(width, height)
  const longPx = Math.max(width, height)
  const ratio = +(longPx / shortPx).toFixed(2)

  let diagonal
  if (Number.isFinite(rawInches) && rawInches > 0) {
    diagonal = +rawInches.toFixed(2)
  } else if (hasExplicitDpi) {
    const widthIn = width / xdpi
    const heightIn = height / ydpi
    const calcDiag = Math.hypot(widthIn, heightIn)
    diagonal = (calcDiag >= 0.8 && calcDiag <= 30) ? +calcDiag.toFixed(2) : 6.4
  } else {
    diagonal = ratio < 1.45 ? 7.9 : 6.4
  }

  let formFactor
  if (diagonal < 2.8) {
    formFactor = 'wearable'
  } else if (diagonal > 7.1 || ratio < 1.45) {
    formFactor = 'foldable-tablet'
  } else if ((sdk !== null && sdk <= 26) || ratio <= 1.78) {
    formFactor = 'legacy-16-9'
  } else if (ratio >= 2.28) {
    formFactor = 'ultra-tall-21-9'
  } else {
    formFactor = 'modern-punch-hole'
  }

  return {
    width,
    height,
    xdpi,
    ydpi,
    sdk,
    ratio,
    diagonal,
    formFactor
  }
}

function resolveDeviceIdentity(params = {}) {
  const rawPlatform = typeof params.platform === 'string' ? params.platform.trim() : ''
  const rawImage = typeof params.image === 'string' ? params.image.trim() : ''
  const imageStem = stripImageExtension(rawImage)
  const isGenericStem = /^generic-phone-v1$/i.test(imageStem)

  const rawBrand = typeof params.brand === 'string' && params.brand.trim()
    ? params.brand.trim()
    : (typeof params.manufacturer === 'string' && params.manufacturer.trim() ? params.manufacturer.trim() : '')
  const rawModel = typeof params.model === 'string' && params.model.trim() ? params.model.trim() : ''
  const rawMarket = typeof params.marketName === 'string' && params.marketName.trim()
    ? params.marketName.trim()
    : (params.name && typeof params.name === 'object' && typeof params.name.id === 'string' ? params.name.id.trim() : '')
  const rawCode = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : ''

  const isIos = (
    /^ios$/i.test(rawPlatform) ||
    /^ios$/i.test(imageStem) ||
    /^ios$/i.test(rawModel) ||
    /^ios$/i.test(rawCode)
  )

  const effectiveModel = !rawModel || /^generic-phone-v1$/i.test(rawModel)
    ? (!isGenericStem && !isIos ? imageStem : '')
    : rawModel
  const effectiveCode = !rawCode || /^generic-phone-v1$/i.test(rawCode)
    ? ''
    : rawCode

  const effectiveMarket = isIos && /^ios$/i.test(rawMarket) ? '' : rawMarket

  let matched = null
  if (!isIos) {
    if (effectiveModel || effectiveCode) {
      matched = find({
        model: effectiveModel,
        name: effectiveCode || effectiveModel,
        brand: rawBrand,
        platform: rawPlatform
      })
    }
    if (!matched && imageStem && !isGenericStem && imageStem !== effectiveModel) {
      matched = find({
        model: imageStem,
        name: imageStem,
        brand: rawBrand,
        platform: rawPlatform
      })
    }
    if (!matched && effectiveMarket) {
      matched = find({
        model: effectiveMarket,
        name: effectiveMarket,
        brand: rawBrand,
        platform: rawPlatform
      })
    }
  }
  const brand = isIos
    ? (rawBrand || 'Apple')
    : ((matched && matched.brand && (!rawBrand || brandsMatch(rawBrand, matched.brand)))
        ? matched.brand
        : (rawBrand || (matched && matched.brand) || 'Generic'))
  const model = effectiveMarket ||
    (matched && matched.marketName) ||
    (isIos && /^ios$/i.test(effectiveModel) ? '' : effectiveModel) ||
    (isIos && /^ios$/i.test(effectiveCode) ? '' : effectiveCode) ||
    (isIos ? 'iOS Device' : 'Android Device')
  const displayRawModel = (isIos && /^ios$/i.test(effectiveModel) ? '' : effectiveModel) || model
  const date = (typeof params.date === 'string' && params.date.trim() ? params.date.trim() : null) ||
    (matched && matched.date) ||
    null
  const cpu = (params.cpu && typeof params.cpu === 'object' ? params.cpu : null) ||
    (matched && matched.cpu) ||
    null
  const memory = (params.memory && typeof params.memory === 'object' ? params.memory : null) ||
    (matched && matched.memory) ||
    null

  return {
    brand,
    model,
    rawModel: displayRawModel,
    date,
    cpu,
    memory,
    isIos
  }
}

function truncateText(text, maxLen) {
  const str = String(text || '').trim()
  if (str.length <= maxLen) return str
  return str.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '…'
}

function renderX24Svg(metrics, palette, identity) {
  const { formFactor, ratio } = metrics
  const title = escapeXml(`${identity.brand} ${identity.model}`.trim())

  if (formFactor === 'wearable') {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" data-size="x24" data-form-factor="wearable">',
      `<title>${title}</title>`,
      `<rect x="9" y="1" width="6" height="22" rx="2" fill="${palette.chassis}" stroke="${palette.border}" stroke-width="1"/>`,
      `<circle cx="12" cy="12" r="7" fill="${palette.surface}" stroke="${palette.primary}" stroke-width="1.5"/>`,
      `<circle cx="12" cy="12" r="4.5" fill="${palette.secondary}"/>`,
      `<circle cx="12" cy="12" r="1.5" fill="${palette.accent}"/>`,
      '</svg>'
    ].join('')
  }

  let bodyW = 12
  let bodyH = 20
  let rx = 2.5

  if (formFactor === 'foldable-tablet') {
    bodyW = 16
    bodyH = 20
    rx = 2
  } else if (formFactor === 'legacy-16-9') {
    bodyW = 13
    bodyH = 20
    rx = 2
  } else if (formFactor === 'ultra-tall-21-9') {
    bodyW = 10
    bodyH = 21
    rx = 2
  } else {
    // modern-punch-hole
    bodyW = Math.max(10, Math.min(14, Math.round(20 / Math.max(1.5, Math.min(2.2, ratio)))))
    bodyH = 20
    rx = 2.5
  }

  const bodyX = +((24 - bodyW) / 2).toFixed(2)
  const bodyY = +((24 - bodyH) / 2).toFixed(2)
  const screenPadX = 1.5
  const screenPadTop = formFactor === 'legacy-16-9' ? 2.5 : 1.5
  const screenPadBottom = formFactor === 'legacy-16-9' ? 3 : 1.5
  const screenX = +(bodyX + screenPadX).toFixed(2)
  const screenY = +(bodyY + screenPadTop).toFixed(2)
  const screenW = +(bodyW - screenPadX * 2).toFixed(2)
  const screenH = +(bodyH - screenPadTop - screenPadBottom).toFixed(2)

  let cutout = ''
  if (formFactor === 'foldable-tablet') {
    cutout = `<line x1="12" y1="${screenY}" x2="12" y2="${+(screenY + screenH).toFixed(2)}" stroke="${palette.border}" stroke-width="0.75" stroke-dasharray="1.5 1"/>`
  } else if (formFactor === 'legacy-16-9') {
    const homeY = +(bodyY + bodyH - 1.5).toFixed(2)
    cutout = `<circle cx="12" cy="${homeY}" r="0.9" fill="${palette.accent}"/>`
  } else {
    const holeY = +(screenY + 1.5).toFixed(2)
    cutout = `<circle cx="12" cy="${holeY}" r="0.85" fill="${palette.surface}"/>`
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" data-size="x24" data-form-factor="${formFactor}">`,
    `<title>${title}</title>`,
    `<rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${rx}" fill="${palette.chassis}" stroke="${palette.primary}" stroke-width="1.2"/>`,
    `<rect x="${screenX}" y="${screenY}" width="${screenW}" height="${screenH}" rx="1.2" fill="${palette.secondary}"/>`,
    cutout,
    '</svg>'
  ].join('')
}

function computeBodyGeometry(metrics, maxW, maxH, centerX, centerY) {
  const { formFactor, ratio } = metrics
  if (formFactor === 'wearable') {
    const radius = Math.round(Math.min(maxW, maxH) * 0.36)
    return {
      isWearable: true,
      cx: centerX,
      cy: centerY,
      radius,
      strapW: Math.round(radius * 0.9),
      strapH: Math.round(maxH * 0.92),
      bodyX: centerX - radius,
      bodyY: centerY - radius,
      bodyW: radius * 2,
      bodyH: radius * 2
    }
  }

  const clampedRatio = formFactor === 'foldable-tablet'
    ? Math.max(1.15, Math.min(1.6, ratio))
    : Math.max(1.5, Math.min(2.35, ratio))

  let bodyH = maxH
  let bodyW = Math.round(bodyH / clampedRatio)
  if (bodyW > maxW) {
    bodyW = maxW
    bodyH = Math.round(bodyW * clampedRatio)
  }

  const bodyX = Math.round(centerX - bodyW / 2)
  const bodyY = Math.round(centerY - bodyH / 2)

  const sideBezel = Math.max(2, Math.round(bodyW * (formFactor === 'legacy-16-9' ? 0.08 : 0.05)))
  const topBezel = Math.max(
    3,
    Math.round(bodyH * (formFactor === 'legacy-16-9' ? 0.11 : (formFactor === 'ultra-tall-21-9' ? 0.045 : 0.04)))
  )
  const bottomBezel = Math.max(
    3,
    Math.round(bodyH * (formFactor === 'legacy-16-9' ? 0.12 : 0.045))
  )

  return {
    isWearable: false,
    bodyX,
    bodyY,
    bodyW,
    bodyH,
    rx: Math.round(bodyW * (formFactor === 'foldable-tablet' ? 0.08 : 0.14)),
    screenX: bodyX + sideBezel,
    screenY: bodyY + topBezel,
    screenW: bodyW - sideBezel * 2,
    screenH: bodyH - topBezel - bottomBezel,
    screenRx: Math.max(2, Math.round(bodyW * (formFactor === 'foldable-tablet' ? 0.05 : 0.1))),
    topBezel,
    bottomBezel
  }
}

function renderDeviceHardware(geom, metrics, palette, scale, gradId) {
  const { formFactor } = metrics
  const parts = []

  if (geom.isWearable) {
    const strapX = Math.round(geom.cx - geom.strapW / 2)
    const strapY = Math.round(geom.cy - geom.strapH / 2)
    parts.push(
      `<rect x="${strapX}" y="${strapY}" width="${geom.strapW}" height="${geom.strapH}" rx="${Math.round(6 * scale)}" fill="${palette.chassis}" stroke="${palette.border}" stroke-width="${+(1.2 * scale).toFixed(2)}"/>`,
      `<circle cx="${geom.cx}" cy="${geom.cy}" r="${geom.radius}" fill="${palette.chassis}" stroke="${palette.primary}" stroke-width="${+(2 * scale).toFixed(2)}"/>`,
      `<circle cx="${geom.cx}" cy="${geom.cy}" r="${Math.round(geom.radius * 0.84)}" fill="url(#${gradId})"/>`
    )
    return parts.join('')
  }

  parts.push(
    `<rect x="${geom.bodyX}" y="${geom.bodyY}" width="${geom.bodyW}" height="${geom.bodyH}" rx="${geom.rx}" fill="${palette.chassis}" stroke="${palette.primary}" stroke-width="${+(1.5 * scale).toFixed(2)}"/>`,
    `<rect x="${geom.screenX}" y="${geom.screenY}" width="${geom.screenW}" height="${geom.screenH}" rx="${geom.screenRx}" fill="url(#${gradId})"/>`
  )

  const midX = Math.round(geom.bodyX + geom.bodyW / 2)

  if (formFactor === 'legacy-16-9') {
    const speakerW = Math.max(8, Math.round(geom.bodyW * 0.24))
    const speakerY = Math.round(geom.bodyY + geom.topBezel / 2)
    const homeR = Math.max(2, Math.round(geom.bottomBezel * 0.28))
    const homeY = Math.round(geom.bodyY + geom.bodyH - geom.bottomBezel / 2)
    parts.push(
      `<line x1="${midX - Math.round(speakerW / 2)}" y1="${speakerY}" x2="${midX + Math.round(speakerW / 2)}" y2="${speakerY}" stroke="${palette.border}" stroke-width="${+(1.5 * scale).toFixed(2)}" stroke-linecap="round"/>`,
      `<circle cx="${midX}" cy="${homeY}" r="${homeR}" fill="none" stroke="${palette.accent}" stroke-width="${+(1.2 * scale).toFixed(2)}"/>`
    )
  } else if (formFactor === 'foldable-tablet') {
    const creaseTop = geom.screenY
    const creaseBottom = geom.screenY + geom.screenH
    const camR = Math.max(1.5, +(2 * scale).toFixed(2))
    const camX = Math.round(geom.screenX + geom.screenW * 0.75)
    const camY = Math.round(geom.screenY + Math.max(4, geom.topBezel * 1.1))
    parts.push(
      `<line x1="${midX}" y1="${creaseTop}" x2="${midX}" y2="${creaseBottom}" stroke="${palette.border}" stroke-width="${+(1 * scale).toFixed(2)}" stroke-dasharray="${3 * scale} ${2 * scale}" opacity="0.75"/>`,
      `<circle cx="${camX}" cy="${camY}" r="${camR}" fill="${palette.surface}" stroke="${palette.border}" stroke-width="${+(0.6 * scale).toFixed(2)}"/>`
    )
  } else if (formFactor === 'ultra-tall-21-9') {
    const holeR = Math.max(1.5, +(1.8 * scale).toFixed(2))
    const holeY = Math.round(geom.screenY + Math.max(4, 5 * scale))
    parts.push(
      `<circle cx="${midX}" cy="${holeY}" r="${holeR}" fill="${palette.surface}" stroke="${palette.border}" stroke-width="${+(0.6 * scale).toFixed(2)}"/>`
    )
  } else {
    // modern-punch-hole
    const holeR = Math.max(1.6, +(2.2 * scale).toFixed(2))
    const holeY = Math.round(geom.screenY + Math.max(4.5, 6 * scale))
    parts.push(
      `<circle cx="${midX}" cy="${holeY}" r="${holeR}" fill="${palette.surface}" stroke="${palette.border}" stroke-width="${+(0.7 * scale).toFixed(2)}"/>`
    )
  }

  return parts.join('')
}

function renderX120Svg(metrics, palette, identity) {
  const { diagonal, formFactor } = metrics
  const gradId = `screenGrad-x120-${palette.hue}`
  const brandText = escapeXml(truncateText(identity.brand, 16))
  const modelText = escapeXml(truncateText(identity.model, 18))
  const diagText = escapeXml(`${diagonal}"`)
  const title = escapeXml(`${identity.brand} ${identity.model} (${diagonal}")`.trim())

  const geom = computeBodyGeometry(metrics, 68, 76, 60, 46)
  const hardware = renderDeviceHardware(geom, metrics, palette, 1, gradId)

  const diagY = geom.isWearable ? geom.cy + 3 : Math.round(geom.screenY + geom.screenH * 0.56)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" data-size="x120" data-form-factor="${formFactor}">`,
    `<title>${title}</title>`,
    '<defs>',
    `<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="${palette.primary}"/>`,
    `<stop offset="100%" stop-color="${palette.secondary}"/>`,
    '</linearGradient>',
    '</defs>',
    `<rect x="2" y="2" width="116" height="116" rx="12" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1"/>`,
    hardware,
    `<text x="60" y="${diagY}" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700">${diagText}</text>`,
    `<text x="60" y="98" text-anchor="middle" fill="${palette.accent}" font-family="system-ui, -apple-system, sans-serif" font-size="9" font-weight="600">${brandText}</text>`,
    `<text x="60" y="111" text-anchor="middle" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="700">${modelText}</text>`,
    '</svg>'
  ].join('')
}

function renderX800Svg(metrics, palette, identity) {
  const { width, height, xdpi, ydpi, ratio, diagonal, formFactor, sdk } = metrics
  const gradId = `screenGrad-x800-${palette.hue}`
  const brandText = escapeXml(truncateText(identity.brand, 40))
  const modelText = escapeXml(truncateText(identity.model, 38))
  const rawModelText = escapeXml(truncateText(identity.rawModel, 28))
  const diagText = escapeXml(`${diagonal}"`)
  const resText = escapeXml(`${width}x${height} px (${Math.round(xdpi)}x${Math.round(ydpi)} dpi)`)
  const ratioText = escapeXml(`Aspect Ratio ${ratio}:1 • Form Factor: ${formFactor}`)
  const dateText = escapeXml(
    identity.date
      ? `Released: ${identity.date}`
      : (!identity.isIos && sdk ? `Android SDK ${sdk}` : (identity.isIos ? 'Apple iOS' : 'Open Device Database'))
  )
  const cpuText = identity.cpu && identity.cpu.name
    ? escapeXml(`SoC: ${truncateText(identity.cpu.name, 42)}${identity.cpu.cores ? ` (${identity.cpu.cores}-core)` : ''}`)
    : ''
  const memText = identity.memory && (identity.memory.ram || identity.memory.rom)
    ? escapeXml(`Memory: ${identity.memory.ram ? `${identity.memory.ram} MB RAM` : ''}${identity.memory.ram && identity.memory.rom ? ' / ' : ''}${identity.memory.rom ? `${identity.memory.rom} GB Storage` : ''}`)
    : ''
  const hwSummaryText = [cpuText, memText].filter(Boolean).join(' • ')

  const title = escapeXml(`${identity.brand} ${identity.model} (${diagonal}")`.trim())
  const geom = computeBodyGeometry(metrics, 420, 520, 400, 320)
  const hardware = renderDeviceHardware(geom, metrics, palette, 3.2, gradId)
  const centerTextY = geom.isWearable ? geom.cy : Math.round(geom.screenY + geom.screenH * 0.48)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800" role="img" data-size="x800" data-form-factor="${formFactor}">`,
    `<title>${title}</title>`,
    '<defs>',
    `<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="${palette.primary}"/>`,
    `<stop offset="100%" stop-color="${palette.secondary}"/>`,
    '</linearGradient>',
    '</defs>',
    `<rect x="16" y="16" width="768" height="768" rx="36" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3"/>`,
    hardware,
    `<text x="400" y="${centerTextY - 12}" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="800">${diagText}</text>`,
    `<text x="400" y="${centerTextY + 22}" text-anchor="middle" fill="#e2e8f0" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="500">${resText}</text>`,
    `<text x="400" y="640" text-anchor="middle" fill="${palette.accent}" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="700">${brandText}</text>`,
    `<text x="400" y="676" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800">${modelText}</text>`,
    `<text x="400" y="706" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="500">${rawModelText} • ${ratioText}</text>`,
    `<text x="400" y="732" text-anchor="middle" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="15">${dateText}</text>`,
    hwSummaryText ? `<text x="400" y="754" text-anchor="middle" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="14">${hwSummaryText}</text>` : '',
    '</svg>'
  ].join('')
}

function generateDeviceSvg(params = {}) {
  const safeParams = params && typeof params === 'object' ? params : {}
  const rawSize = typeof safeParams.size === 'string' ? safeParams.size.trim().toLowerCase() : 'x120'
  const size = (rawSize === 'x24' || rawSize === '24')
    ? 'x24'
    : (rawSize === 'x800' || rawSize === '800' ? 'x800' : 'x120')

  const identity = resolveDeviceIdentity(safeParams)
  const metrics = computeDisplayMetrics(safeParams, identity.isIos)
  const palette = getBrandPalette(identity.brand)

  if (size === 'x24') {
    return renderX24Svg(metrics, palette, identity)
  }
  if (size === 'x800') {
    return renderX800Svg(metrics, palette, identity)
  }
  return renderX120Svg(metrics, palette, identity)
}

function getDeviceSvgDataUri(params = {}) {
  const svg = generateDeviceSvg(params)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

module.exports = {
  find,
  sample,
  brandsMatch,
  generateDeviceSvg,
  getDeviceSvgDataUri
}
