import type { AttachmentKind } from '@prisma/client'
import type { EventCategory } from '../../event-categories'
import type { GenreKey } from '../../genres'
import type { SubcategoryKey } from '../../subcategories'

// Dicionário canônico. O `satisfies` por seção amarra a copy à taxonomia:
// categoria/subcategoria/gênero sem rótulo não compila.
// As deprecadas (TECH, BUSINESS...) mantêm rótulo: dado legado ainda é exibido.
const categories = {
  MUSIC: 'Música',
  SPORTS: 'Esportes',
  TECH: 'Tecnologia',
  GASTRONOMY: 'Gastronomia',
  CAFE: 'Café',
  ART: 'Arte',
  EDUCATION: 'Educação',
  NIGHTLIFE: 'Vida noturna',
  BUSINESS: 'Negócios',
  HEALTH_WELLNESS: 'Saúde e bem-estar',
  OUTDOORS: 'Ar livre',
  GAMING: 'Jogos',
  FILM_THEATER: 'Cinema e teatro',
  COMEDY: 'Comédia',
  FASHION: 'Moda',
  MARKETS: 'Feiras',
  RELIGION: 'Religião',
  FAMILY: 'Família',
  PETS: 'Pet friendly',
  VOLUNTEERING: 'Voluntariado',
  PARTY: 'Festa',
  OTHER: 'Outros',
  BRECHO: 'Brechó',
  FESTIVAL: 'Festivais',
} as const satisfies Record<EventCategory, string>

const subcategories = {
  NIGHTLIFE_BALADA: 'Balada',
  PARTY_DANCA: 'Dança',
  NIGHTLIFE_BAR: 'Bar',
  NIGHTLIFE_PUB: 'Pub',
  NIGHTLIFE_VINHO: 'Bar de vinhos',
  MUSIC_SHOW: 'Casa de show',
  MUSIC_KARAOKE: 'Karaokê',
  GASTRONOMY_RESTAURANTE: 'Restaurante',
  GASTRONOMY_PIZZA: 'Pizzaria',
  GASTRONOMY_JAPONESA: 'Japonesa',
  GASTRONOMY_CHURRASCO: 'Churrasco',
  GASTRONOMY_BRUNCH: 'Brunch',
  CAFE_CAFETERIA: 'Cafeteria',
  CAFE_PADARIA: 'Padaria',
  CAFE_DOCERIA: 'Doceria',
  CAFE_SORVETERIA: 'Sorveteria',
  CAFE_CHA: 'Casa de chá',
  CAFE_SUCOS: 'Sucos',
  MARKETS_FEIRA: 'Feira',
  MARKETS_PRACA: 'Praça de alimentação',
  SPORTS_ACADEMIA: 'Academia',
  SPORTS_QUADRA: 'Quadras e arenas',
  SPORTS_NATACAO: 'Natação',
  SPORTS_GOLFE: 'Golfe',
  SPORTS_SKATE: 'Skate',
  ART_MUSEU: 'Museu',
  ART_GALERIA: 'Galeria e ateliê',
  ART_CULTURAL: 'Centro cultural',
  FILM_CINEMA: 'Cinema',
  FILM_TEATRO: 'Teatro',
  GAMING_FLIPERAMA: 'Fliperama',
  GAMING_ESPORTS: 'E-sports',
  GAMING_TABULEIRO: 'Jogos de tabuleiro',
  GAMING_RPG: 'RPG',
  OUTDOORS_PARQUE: 'Parque',
  OUTDOORS_TRILHA: 'Trilha e camping',
  OUTDOORS_PRAIA: 'Praia',
  OUTDOORS_TURISMO: 'Ponto turístico',
  BRECHO_GARIMPO: 'Garimpo e vintage',
} as const satisfies Record<SubcategoryKey, string>

const genres = {
  GENRE_SERTANEJO: 'Sertanejo',
  GENRE_FUNK: 'Funk',
  GENRE_PAGODE_SAMBA: 'Pagode e samba',
  GENRE_ROCK: 'Rock',
  GENRE_POP: 'Pop',
  GENRE_RAP: 'Rap e hip-hop',
  GENRE_FORRO: 'Forró',
  GENRE_PISEIRO: 'Piseiro',
  GENRE_AXE: 'Axé',
  GENRE_INDIE: 'Indie e alternativo',
  GENRE_HOUSE: 'House',
  GENRE_TECH_HOUSE: 'Tech house',
  GENRE_TECHNO: 'Techno',
  GENRE_PSYTRANCE: 'Psytrance',
  GENRE_DNB: 'Drum and bass',
  GENRE_EDM: 'EDM',
} as const satisfies Record<GenreKey, string>

// Copy das notificações: mesma fonte para a lista in-app e para o push. O nome
// do autor entra como {{actor}} na leitura (derivado da FK, acompanha rename);
// os demais params são snapshot gravado na escrita (ver notification-params).
const notifications = {
  unknownActor: 'Alguém',
  followRequest: {
    title: 'Nova solicitação',
    body: '{{actor}} quer te seguir',
  },
  followAccepted: {
    title: 'Solicitação aceita',
    body: '{{actor}} aceitou seu pedido para seguir',
  },
  newFollower: {
    title: 'Novo seguidor',
    body: '{{actor}} começou a te seguir',
  },
  eventInvite: {
    title: 'Convite para evento',
    body: '{{actor}} te convidou para um evento',
  },
  eventComment: {
    title: 'Novo comentário',
    body: '{{actor}} comentou no seu evento',
  },
  postComment: {
    title: 'Novo comentário',
    body: '{{actor}} comentou no seu post',
  },
  commentReply: {
    title: 'Nova resposta',
    body: '{{actor}} respondeu seu comentário',
  },
  eventReaction: {
    title: 'Nova curtida',
    body: '{{actor}} curtiu seu evento',
  },
  postReaction: {
    title: 'Nova curtida',
    body: '{{actor}} curtiu seu post',
  },
  commentReaction: {
    title: 'Nova curtida',
    body: '{{actor}} curtiu seu comentário',
  },
  eventAttendance: {
    title: 'Nova presença',
    body: '{{actor}} vai ao seu evento',
  },
  eventNearby: {
    title: 'Tem evento perto de você',
    body: '{{eventTitle}}',
  },
  eventPromoted: {
    title: 'Em destaque perto de você',
    body: '{{eventTitle}}',
  },
  spotNearby: {
    title: 'Tem rolê perto de você',
    body: '{{spotTitle}}',
  },
  spotJoin: {
    title: 'Novo membro no rolê',
    body: '{{actor}} entrou em "{{spotTitle}}"',
  },
  spotRenewal: {
    title: 'Seu rolê está acabando',
    body: '"{{spotTitle}}" expira em breve — renove por mais 24h',
  },
} as const

// Push de mensagem de chat: não tem linha de Notification, então a copy é
// resolvida na hora do envio, no idioma de cada destinatário.
const chatPush = {
  groupFallbackTitle: 'Grupo',
  groupBody: '{{sender}}: {{preview}}',
  emptyPreview: 'Nova mensagem',
  attachment: {
    IMAGE: '📷 Foto',
    AUDIO: '🎤 Mensagem de voz',
    VIDEO: '🎬 Vídeo',
  },
} as const satisfies { attachment: Record<AttachmentKind, string> } & Record<
  string,
  unknown
>

// Copy dos e-mails. Só texto: a marcação (tabelas, estilos inline, <strong>)
// fica no template, que interpola o resultado já escapado em {{name}}.
const emails = {
  passwordReset: {
    subject: '{{code}} é o seu código de recuperação — Clubber',
    documentTitle: 'Seu código de recuperação — Clubber',
    preheader: 'Seu código de recuperação é {{code}} — vale por {{duration}}.',
    heading: 'Vamos recuperar sua conta',
    greeting:
      'Oi, {{name}} — recebemos um pedido para redefinir a senha da conta ligada a este e-mail. Use o código abaixo no app para criar uma senha nova.',
    greetingText:
      'Olá, {{name}} — recebemos um pedido para redefinir a senha da conta ligada a este e-mail.',
    codeLabel: 'Seu código',
    minutes_one: '{{count}} minuto',
    minutes_other: '{{count}} minutos',
    expiry:
      'O código vale por {{duration}} e só pode ser usado uma vez. Digite-o na tela de recuperação do app — nunca compartilhe com ninguém.',
    notYou:
      'Não foi você? Pode ignorar este e-mail — o código expira sozinho e sua senha continua a mesma.',
    footerReason:
      'Você recebeu este e-mail porque alguém pediu a recuperação desta conta no Clubber.',
    helpCenter: 'Central de ajuda',
  },
} as const

// Copy da sugestão quando a IA está fora (sem chave/timeout/erro). Cada idioma
// é escrito nativamente, no mesmo registro de convite do prompt: degradar de IA
// para template não pode degradar de idioma.
const spots = {
  suggestionFallbackTitle: 'Bora um rolê no {{name}}?',
} as const

export const ptBR = {
  categories,
  subcategories,
  genres,
  notifications,
  chatPush,
  emails,
  spots,
} as const
