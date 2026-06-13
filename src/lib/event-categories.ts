import { z } from 'zod'

/**
 * Lista canônica de categorias de evento. Compartilhada entre a criação/edição
 * de eventos (Event.categories[]) e as preferências de perfil
 * (UserCategoryPreference.category). Espelha o enum `EventCategory` do Prisma.
 *
 * Os valores são identificadores estáveis em inglês/maiúsculas, seguindo a
 * convenção dos demais enums do schema (AttendanceType, ReportReason etc.).
 * O label exibido ao usuário é responsabilidade do client.
 */
export const EVENT_CATEGORIES = [
  'MUSIC',
  'SPORTS',
  'TECH',
  'GASTRONOMY',
  'ART',
  'EDUCATION',
  'NIGHTLIFE',
  'BUSINESS',
  'HEALTH_WELLNESS',
  'OUTDOORS',
  'GAMING',
  'FILM_THEATER',
  'FASHION',
  'RELIGION',
  'FAMILY',
  'PETS',
  'VOLUNTEERING',
  'PARTY',
  'OTHER',
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const eventCategorySchema = z.enum(EVENT_CATEGORIES)

/**
 * Locale padrão (lançamento no Brasil). Usado como fallback quando o
 * Accept-Language pedido não tem dicionário.
 */
export const DEFAULT_LOCALE = 'pt-BR'

/**
 * Rótulos exibíveis por locale. O banco guarda só o identificador neutro
 * (ex: 'MUSIC'); a tradução vive aqui. Adicionar um idioma = adicionar um
 * dicionário — sem migração de banco e sem deploy do app.
 */
const CATEGORY_LABELS: Record<string, Record<EventCategory, string>> = {
  'pt-BR': {
    MUSIC: 'Música',
    SPORTS: 'Esportes',
    TECH: 'Tecnologia',
    GASTRONOMY: 'Gastronomia',
    ART: 'Arte',
    EDUCATION: 'Educação',
    NIGHTLIFE: 'Vida noturna',
    BUSINESS: 'Negócios',
    HEALTH_WELLNESS: 'Saúde e bem-estar',
    OUTDOORS: 'Ar livre',
    GAMING: 'Games',
    FILM_THEATER: 'Cinema e teatro',
    FASHION: 'Moda',
    RELIGION: 'Religião',
    FAMILY: 'Família',
    PETS: 'Pets',
    VOLUNTEERING: 'Voluntariado',
    PARTY: 'Festa',
    OTHER: 'Outros',
  },
}

/**
 * Resolve um locale suportado a partir de um header Accept-Language.
 * Aceita match exato ('pt-BR') ou por idioma base ('pt' → 'pt-BR').
 * Cai para DEFAULT_LOCALE quando não há dicionário compatível.
 */
export function resolveLocale(acceptLanguage?: string): string {
  if (!acceptLanguage) return DEFAULT_LOCALE
  const primary = acceptLanguage.split(',')[0]?.trim()
  if (!primary) return DEFAULT_LOCALE
  if (CATEGORY_LABELS[primary]) return primary
  const base = primary.split('-')[0]?.toLowerCase()
  const found = Object.keys(CATEGORY_LABELS).find(
    (l) => l.split('-')[0]?.toLowerCase() === base,
  )
  return found ?? DEFAULT_LOCALE
}

export type CategoryOption = { value: EventCategory; label: string }

/**
 * Lista canônica de categorias com rótulo no locale pedido (fallback pt-BR).
 * Fonte única consumida pelo seletor (cadastro/edição de perfil, criação de
 * evento) e pela exibição nos cards.
 */
export function listCategories(
  locale: string = DEFAULT_LOCALE,
): CategoryOption[] {
  const labels = CATEGORY_LABELS[locale] ?? CATEGORY_LABELS[DEFAULT_LOCALE]
  return EVENT_CATEGORIES.map((value) => ({ value, label: labels[value] }))
}
