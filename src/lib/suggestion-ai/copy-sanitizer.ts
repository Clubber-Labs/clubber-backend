// Garantia determinística das regras de produto da copy factual: a probe
// mostrou que instrução no prompt reduz mas não zera os vazamentos, então o
// contrato é enforçado aqui — como o clamp de tamanho, o servidor é a fonte
// da verdade, não a obediência do modelo.

// Reputação/fonte: o card informa fato, nunca opinião agregada nem de onde
// o fato veio ("bem avaliado", "elogiado", "o melhor da região", "reviews").
const REPUTATION = [
  /avalia/i,
  /elogi/i,
  /renomad/i,
  /famos/i,
  /conceituad/i,
  /recomendad/i,
  /melhor d[aeo]\b/i,
  /referência em/i,
  /\breviews?\b/i,
  /frequentador/i,
  /\btop.?rated\b/i,
  /\bfamous\b/i,
  /\bacclaimed\b/i,
  /\breseñ/i,
  /\brecomendac/i,
]

// Identidade: decisão de produto — nada que rotule público ou programação por
// orientação/identidade; "público mais alternativo" é o teto (vem do prompt).
const IDENTITY = [
  /lgbt/i,
  /\bdrags?\b/i,
  /drag queen/i,
  /\bgay\b/i,
  /\bqueer\b/i,
  /orgulho/i,
  /\bpride\b/i,
]

// Depreciativo: a recomendação nunca joga contra o estabelecimento.
const DEPRECIATION = [
  /pequen/i,
  /apertad/i,
  /lotad/i,
  /demorad/i,
  /\bruim\b/i,
  /\bfrac[oa]\b/i,
  /\bsuj[oa]\b/i,
  /\bcrowded\b/i,
  /\btiny\b/i,
]

const BANNED = [...REPUTATION, ...IDENTITY, ...DEPRECIATION]

/** true quando o texto não contém nenhum termo banido. */
export function isCleanFact(text: string): boolean {
  return !BANNED.some((re) => re.test(text))
}

/** Descarta os highlights que violam as regras (fato ruim não é reescrevível). */
export function sanitizeHighlights(highlights: string[]): string[] {
  return highlights.filter(isCleanFact)
}

/** `about` violado vira null — card enxuto é melhor que regra vazada. */
export function sanitizeAbout(about: string | null): string | null {
  return about !== null && isCleanFact(about) ? about : null
}
