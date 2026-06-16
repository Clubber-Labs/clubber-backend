// Filtro de conteúdo ADULTO para a recomendação de spots. O Google Places tipa
// casa de swing, balada liberal, termas e strip club como `night_club`/`bar` —
// indistinguíveis de uma balada comum pelo TIPO. O sinal confiável é o NOME, daí
// esta denylist de termos. É content-safety (app social de rolês, público jovem),
// não a heurística-remendo que o filtro estrutural substituiu: aqui o nome é
// genuinamente a única evidência. Roda como filtro HARD (nunca bypassado).

// Termos casados por palavra (com prefixo \w* onde a flexão é segura). Curado
// para alta precisão — evita falsos positivos conhecidos: "swingueira" (gênero de
// festa, não swing), "sexta" (≠ sex), "liberdade" (≠ liberal), "privado" (≠ privê),
// "gogó" (garganta, ex.: "Bar do Gogó" — não é go-go bar). O strip/cabaré já está
// coberto por strip/pole/lap/table dance, e a IA tem seu próprio descarte adulto
// como segunda barreira; num filtro HARD (sem backstop) preferimos não arriscar FP.
const ADULT_TERMS = [
  'swing',
  'swinger',
  'swingers',
  'liberal',
  'liberais',
  'prive\\w*',
  'termas',
  'eroti\\w*',
  'strip\\w*',
  'sex',
  'sexy',
  'sexo',
  'sexual',
  'sexshop',
  'sexyshop',
  'bordel',
  'cabare',
  'puteiro',
  'putaria',
  'menage',
  'orgia\\w*',
  'libertin\\w*',
  'acompanhante\\w*',
  'fetich\\w*',
  'pole ?dance',
  'lap ?dance',
  'table ?dance',
]

// Sem flag 'i': normalize() já minúscula a entrada e os termos são todos lowercase
// — case fica concentrado num único ponto (a normalização), não duplicado aqui.
const ADULT_RE = new RegExp(`\\b(${ADULT_TERMS.join('|')})\\b`)

/** Minúsculas + remoção de acentos, para casar "erótico"/"privê" sem variações. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** O nome do venue indica conteúdo adulto/sexual (swing, liberal, strip, etc.)? */
export function isAdultVenue(name: string): boolean {
  return ADULT_RE.test(normalize(name))
}
