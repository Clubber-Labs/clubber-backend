import type { EventCategory } from '../event-categories'
import { SUBCATEGORIES } from '../subcategories'

// Mapa categoria/subcategoria de rolê -> tipos do Google Places (New), usados
// como includedTypes na busca. DERIVADO da taxonomia de subcategorias
// (src/lib/subcategories.ts) — fonte única, sem duplicação/drift. A taxonomia é
// uma PARTIÇÃO: cada tipo do Places pertence a uma única subcategoria, logo a um
// único pai, então todo candidato volta rotulado de forma determinística.
//
// Categorias sem subcategoria (TECH, BUSINESS, VOLUNTEERING, OTHER) ficam órfãs
// (sem tipo) de propósito — o service barra com 400 quando TODAS as preferências
// caem aqui.

// Reverso tipo -> subcategoria (derivado da partição).
const PLACE_TYPE_TO_SUBCATEGORY = new Map<string, string>()
for (const s of SUBCATEGORIES) {
  for (const t of s.placeTypes) PLACE_TYPE_TO_SUBCATEGORY.set(t, s.key)
}

// Reverso tipo -> categoria (derivado), + tipos LEGADOS de categorias
// descontinuadas (RELIGION não tem subcategoria, mas ainda rotula dado antigo).
const LEGACY_TYPE_TO_CATEGORY: Record<string, EventCategory> = {
  church: 'RELIGION',
}
const PLACE_TYPE_TO_CATEGORY = new Map<string, EventCategory>()
for (const s of SUBCATEGORIES) {
  for (const t of s.placeTypes) PLACE_TYPE_TO_CATEGORY.set(t, s.category)
}
for (const [t, c] of Object.entries(LEGACY_TYPE_TO_CATEGORY)) {
  if (!PLACE_TYPE_TO_CATEGORY.has(t)) PLACE_TYPE_TO_CATEGORY.set(t, c)
}

// Forward categoria -> tipos (união das subcategorias do pai), derivado. Sem
// dedup: a partição garante que um tipo não se repete entre subcategorias do
// mesmo pai (invariante coberta por teste) e o consumidor ainda usa Set.
const CATEGORY_TO_PLACE_TYPES = new Map<EventCategory, string[]>()
for (const s of SUBCATEGORIES) {
  const list = CATEGORY_TO_PLACE_TYPES.get(s.category) ?? []
  list.push(...s.placeTypes)
  CATEGORY_TO_PLACE_TYPES.set(s.category, list)
}

// Forward subcategoria -> tipos: constante de módulo (igual aos demais mapas),
// evita reconstruir o Map a cada busca precisa (hot path dos próximos PRs).
const SUBCATEGORY_TO_PLACE_TYPES = new Map(
  SUBCATEGORIES.map((s) => [s.key, s.placeTypes]),
)

/** Tipos de Places (deduplicados) para as categorias pedidas. */
export function placeTypesForCategories(categories: EventCategory[]): string[] {
  const types = new Set<string>()
  for (const c of categories) {
    for (const t of CATEGORY_TO_PLACE_TYPES.get(c) ?? []) types.add(t)
  }
  return [...types]
}

/** Tipos de Places (deduplicados) para as subcategorias pedidas (busca precisa). */
export function placeTypesForSubcategories(keys: string[]): string[] {
  const types = new Set<string>()
  for (const k of keys) {
    for (const t of SUBCATEGORY_TO_PLACE_TYPES.get(k) ?? []) types.add(t)
  }
  return [...types]
}

/** Primeira categoria conhecida entre os tipos do Places; OTHER se nenhuma. */
export function categoryForPlaceTypes(types: string[]): EventCategory {
  for (const t of types) {
    const c = PLACE_TYPE_TO_CATEGORY.get(t)
    if (c) return c
  }
  return 'OTHER'
}

/** Primeira subcategoria conhecida entre os tipos; null se nenhuma (palpite). */
export function subcategoryForPlaceTypes(types: string[]): string | null {
  for (const t of types) {
    const s = PLACE_TYPE_TO_SUBCATEGORY.get(t)
    if (s) return s
  }
  return null
}
