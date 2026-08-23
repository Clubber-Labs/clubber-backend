import { z } from 'zod'
import { DEFAULT_LOCALE, type Locale } from './i18n/locale'
import { t } from './i18n/translate'

/**
 * Lista canônica de categorias de evento. Compartilhada entre a criação/edição
 * de eventos (Event.categories[]) e as preferências de perfil
 * (UserCategoryPreference.category). Espelha o enum `EventCategory` do Prisma.
 *
 * Os valores são identificadores estáveis em inglês/maiúsculas, seguindo a
 * convenção dos demais enums do schema (AttendanceType, ReportReason etc.).
 * O banco guarda só o identificador neutro; a tradução vive nos dicionários de
 * lib/i18n/locales. Adicionar um idioma = adicionar um dicionário — sem
 * migração de banco e sem deploy do app.
 */
export const EVENT_CATEGORIES = [
  'MUSIC',
  'SPORTS',
  'TECH',
  'GASTRONOMY',
  'CAFE',
  'ART',
  'EDUCATION',
  'NIGHTLIFE',
  'BUSINESS',
  'HEALTH_WELLNESS',
  'OUTDOORS',
  'GAMING',
  'FILM_THEATER',
  'COMEDY',
  'FASHION',
  'MARKETS',
  'RELIGION',
  'FAMILY',
  'PETS',
  'VOLUNTEERING',
  'PARTY',
  'OTHER',
  'BRECHO',
  'FESTIVAL',
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

// Valores válidos (inclui legados): aceita o que já existe no banco. eventCategorySchema
// valida QUALQUER categoria armazenada — usado para dados/saída.
export const eventCategorySchema = z.enum(EVENT_CATEGORIES)

// Categorias DESCONTINUADAS: continuam válidas como dado legado, mas não são
// oferecidas para nova seleção (some do /categories e da validação de input).
// Curadoria jovem: o app é de rolê social — trabalho, palestra, estudo e
// serviço/varejo utilitário ficam fora do seletor.
const DEPRECATED_CATEGORY_LIST = [
  'RELIGION',
  'TECH',
  'BUSINESS',
  'EDUCATION',
  'FAMILY',
  'VOLUNTEERING',
  'FASHION',
  'HEALTH_WELLNESS',
] as const satisfies readonly EventCategory[]

type DeprecatedCategory = (typeof DEPRECATED_CATEGORY_LIST)[number]

const DEPRECATED_CATEGORIES = new Set<EventCategory>(DEPRECATED_CATEGORY_LIST)

// Categorias SELECIONÁVEIS: o subconjunto que o usuário pode escolher hoje. É a
// fonte do GET /categories e da validação de input (criar evento, preferências).
export const SELECTABLE_CATEGORIES = EVENT_CATEGORIES.filter(
  (c) => !DEPRECATED_CATEGORIES.has(c),
) as Exclude<EventCategory, DeprecatedCategory>[]

// Tipo estreito (exclui as descontinuadas). Faz o schema e quem o consome
// inferirem o subconjunto, não o EventCategory inteiro (RELIGION fora também no tipo).
export type SelectableCategory = (typeof SELECTABLE_CATEGORIES)[number]

export const selectableCategorySchema = z.enum(
  SELECTABLE_CATEGORIES as [SelectableCategory, ...SelectableCategory[]],
)

export type CategoryOption = { value: EventCategory; label: string }

/**
 * Lista canônica de categorias com rótulo no locale pedido (fallback pt-BR).
 * Fonte única consumida pelo seletor (cadastro/edição de perfil, criação de
 * evento) e pela exibição nos cards.
 */
export function listCategories(
  locale: Locale = DEFAULT_LOCALE,
): CategoryOption[] {
  // Só as selecionáveis: categorias descontinuadas (ex.: RELIGION) não aparecem.
  return SELECTABLE_CATEGORIES.map((value) => ({
    value,
    label: t(`categories.${value}`, locale),
  }))
}
