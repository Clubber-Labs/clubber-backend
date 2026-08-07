import type {
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
  /** Sobrescreva para fixar a query reescrita do modo texto num cenário. */
  nextIntentQuery: string | null = null

  async composeProfileQueries(profile: SuggestionProfile): Promise<string[]> {
    this.calls++
    this.lastProfile = profile
    if (this.nextQueries) return this.nextQueries
    // Default: interesses finos antes, depois categorias; dedup e teto de 2.
    return [...new Set([...profile.interests, ...profile.categories])].slice(
      0,
      2,
    )
  }

  async composeIntentQuery(intent: string): Promise<string> {
    this.intentCalls++
    this.lastIntent = intent
    // Default: passa inalterado (espelha o template sem IA).
    return this.nextIntentQuery ?? intent
  }

  reset(): void {
    this.calls = 0
    this.lastProfile = null
    this.nextQueries = null
    this.intentCalls = 0
    this.lastIntent = null
    this.nextIntentQuery = null
  }
}

export const fakeQueryComposer = new FakeProfileQueryComposer()
