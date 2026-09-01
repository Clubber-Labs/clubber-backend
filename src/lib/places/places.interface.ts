/** Candidato de local retornado pela busca (efêmero — não persiste). */
export type PlaceCandidate = {
  placeId: string
  name: string
  latitude: number
  longitude: number
  /** Tipos crus do Google Places (New) — base do filtro de venue social. */
  types: string[]
  address: string | null
  // Sinais de qualidade/relevância para o ranqueamento da IA. `null` quando o
  // Places não traz o dado; `distanceMeters` é sempre calculado do ponto da busca.
  rating: number | null
  userRatingCount: number | null
  priceLevel: string | null
  openNow: boolean | null
  distanceMeters: number
  /**
   * Textos crus de reviews (até 5, SÓ o texto — autor nunca sai do adapter:
   * minimização de dado pessoal). Presente apenas quando a busca pediu
   * `includeReviews`; é insumo do enhancer e NUNCA pode vazar na resposta da
   * API (EnhancedCandidate omite o campo).
   */
  reviews?: string[]
}

/** Busca por intenção em texto livre (Text Search). O ponto é só viés, não trava. */
export type SearchTextParams = {
  textQuery: string
  latitude: number
  longitude: number
  radiusMeters?: number
  limit?: number
  /**
   * BCP-47 do idioma da resposta. Sem ele o Google escolhe sozinho, e o nome
   * que a IA recebe (e reescreve na copy) pode não bater com o idioma do
   * aparelho. Não muda a SKU nem o preço da Text Search.
   */
  languageCode?: string
  /**
   * Pede `places.reviews` no field mask — sobe a chamada de SKU Enterprise para
   * Enterprise+Atmosphere (~US$35→40/1000), então só o fluxo de sugestões (que
   * usa reviews como evidência na IA) deve ligar isto.
   */
  includeReviews?: boolean
}

/**
 * Sugestão do Autocomplete (SKU barata — usada no "digitar para escolher o
 * local do evento"). name/address vêm do structuredFormat da predição; o
 * cliente usa `name` como venueName ao criar o evento (evita pedir displayName
 * no Details, que é SKU Pro).
 */
export type PlaceSuggestion = {
  placeId: string
  name: string
  address: string | null
}

export type AutocompleteParams = {
  input: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  /**
   * Token de sessão do Autocomplete: o app gera um por sessão de digitação e o
   * reusa até o getDetails final — o Google então cobra a sessão inteira como
   * uma única chamada, em vez de uma por keystroke.
   */
  sessionToken?: string
  /** BCP-47 do idioma das sugestões — ver SearchTextParams.languageCode. */
  languageCode?: string
}

/** Detalhes mínimos (SKU Essentials) do lugar escolhido no autocomplete. */
export type PlaceDetails = {
  placeId: string
  latitude: number
  longitude: number
  address: string | null
  types: string[]
}

/** Provedor de busca de estabelecimentos (Google Places). */
export interface IPlacesClient {
  searchText(params: SearchTextParams): Promise<PlaceCandidate[]>
  autocomplete(params: AutocompleteParams): Promise<PlaceSuggestion[]>
  /** null quando o placeId não existe (Places 404). */
  getDetails(
    placeId: string,
    sessionToken?: string,
    languageCode?: string,
  ): Promise<PlaceDetails | null>
}
