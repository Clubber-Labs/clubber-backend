import type { Locale } from '../lib/i18n/locale'
import type {
  ComposedIntent,
  IProfileQueryComposer,
  SuggestionProfile,
} from '../lib/suggestion-ai'

/**
 * Composer fake para testes: determinístico e verificável. Registra o último
 * perfil recebido (`lastProfile`) e conta chamadas (`calls`). Por padrão deriva
 * as frases dos próprios rótulos do perfil; roteirize `nextQueries` para fixar a
 * saída num cenário. Injetado via setProfileQueryComposer no setup.ts.
 */
export class FakeProfileQueryComposer implements IProfileQueryComposer {
  calls = 0
  lastProfile: SuggestionProfile | null = null
  /** Sobrescreva para fixar as frases retornadas num cenário. */
  nextQueries: string[] | null = null
  intentCalls = 0
  lastIntent: string | null = null
  lastLocale: Locale | null = null
  /** Sobrescreva para fixar a reescrita do modo texto num cenário. */
  nextIntent: ComposedIntent | null = null

  async composeProfileQueries(
    profile: SuggestionProfile,
    locale: Locale,
  ): Promise<string[]> {
    this.calls++
    this.lastProfile = profile
    this.lastLocale = locale
    if (this.nextQueries) return this.nextQueries
    // Default: interesses finos antes, depois categorias; dedup e teto de 2.
    return [...new Set([...profile.interests, ...profile.categories])].slice(
      0,
      2,
    )
  }

  async composeIntentQuery(
    intent: string,
    locale: Locale,
  ): Promise<ComposedIntent> {
    this.intentCalls++
    this.lastIntent = intent
    this.lastLocale = locale
    // Default: passa inalterado sem ancorar (espelha o template sem IA).
    return this.nextIntent ?? { query: intent, anchored: false }
  }

  reset(): void {
    this.calls = 0
    this.lastProfile = null
    this.nextQueries = null
    this.intentCalls = 0
    this.lastIntent = null
    this.nextIntent = null
    this.lastLocale = null
  }
}

export const fakeQueryComposer = new FakeProfileQueryComposer()
