// Brand families shared by the lookup (index.js) and the build (scripts/build-db.mjs)

const BRAND_FAMILY = {
  lg: 'lg',
  lge: 'lg',
  'lg electronics': 'lg',
  xiaomi: 'xiaomi',
  redmi: 'xiaomi',
  poco: 'xiaomi',
  blackshark: 'xiaomi',
  'black shark': 'xiaomi',
  huawei: 'huawei',
  honor: 'huawei',
  zte: 'zte',
  nubia: 'zte',
  redmagic: 'zte',
  'red magic': 'zte',
  lenovo: 'lenovo',
  motorola: 'lenovo',
  zuk: 'lenovo',
  alcatel: 'tcl',
  tct: 'tcl',
  'tct alcatel': 'tcl',
  tcl: 'tcl',
  nokia: 'nokia',
  hmd: 'nokia',
  'hmd global': 'nokia',
  vivo: 'vivo',
  iqoo: 'vivo',
  oppo: 'oppo',
  oneplus: 'oppo',
  realme: 'oppo',
  nothing: 'nothing',
  cmf: 'nothing',
  'cmf by nothing': 'nothing',
  asus: 'asus',
  asustek: 'asus',
  sony: 'sony',
  somc: 'sony',
  fxtec: 'fxtec',
  'f x tec': 'fxtec',
  bn: 'bn',
  'barnes noble': 'bn',
  'barnes and noble': 'bn',
  ark: 'ark',
  'ark benefit': 'ark'
}

// Brands whose first word alone identifies the family, e.g. "Motorola Mobility LLC"
const FIRST_WORD_FAMILIES = new Set([
  'motorola',
  'tct',
  'tcl',
  'alcatel',
  'hmd',
  'nokia',
  'asus',
  'asustek',
  'sony',
  'realme',
  'cmf'
])

function canonicalBrand(brand) {
  const norm = String(brand || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!norm) return ''
  if (Object.hasOwn(BRAND_FAMILY, norm)) return BRAND_FAMILY[norm]
  const firstWord = norm.split(' ')[0]
  if (FIRST_WORD_FAMILIES.has(firstWord)) return BRAND_FAMILY[firstWord]
  return norm
}

function brandsMatch(a, b) {
  const ca = canonicalBrand(a)
  const cb = canonicalBrand(b)
  if (!ca || !cb) return true
  if (ca === cb) return true
  return ca.length >= 3 && cb.length >= 3 && (ca.startsWith(cb + ' ') || cb.startsWith(ca + ' '))
}

module.exports = {
  canonicalBrand,
  brandsMatch
}
