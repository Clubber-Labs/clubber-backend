import type { Dictionary } from '../dictionary'

// Copy adaptada para um espanhol neutro entre variantes (ex.: 'Balada' →
// 'Discotecas', não o regional "antros"/"boliches"; 'Funk' → 'Funk brasileño').
export const es: Dictionary = {
  categories: {
    MUSIC: 'Música',
    SPORTS: 'Deportes',
    TECH: 'Tecnología',
    GASTRONOMY: 'Comida',
    CAFE: 'Café',
    ART: 'Arte',
    EDUCATION: 'Educación',
    NIGHTLIFE: 'Vida nocturna',
    BUSINESS: 'Negocios',
    HEALTH_WELLNESS: 'Bienestar',
    OUTDOORS: 'Aire libre',
    GAMING: 'Juegos',
    FILM_THEATER: 'Cine y teatro',
    COMEDY: 'Comedia',
    FASHION: 'Moda',
    MARKETS: 'Ferias',
    RELIGION: 'Religión',
    FAMILY: 'Familia',
    PETS: 'Pet friendly',
    VOLUNTEERING: 'Voluntariado',
    PARTY: 'Fiestas',
    OTHER: 'Otros',
    BRECHO: 'Segunda mano',
    FESTIVAL: 'Festivales',
  },
  subcategories: {
    NIGHTLIFE_BALADA: 'Discotecas',
    PARTY_DANCA: 'Baile',
    NIGHTLIFE_BAR: 'Bares',
    NIGHTLIFE_PUB: 'Pubs',
    NIGHTLIFE_VINHO: 'Bares de vino',
    MUSIC_SHOW: 'Música en vivo',
    MUSIC_KARAOKE: 'Karaoke',
    GASTRONOMY_RESTAURANTE: 'Restaurantes',
    GASTRONOMY_PIZZA: 'Pizzerías',
    GASTRONOMY_JAPONESA: 'Sushi y japonesa',
    GASTRONOMY_CHURRASCO: 'Parrilla',
    GASTRONOMY_BRUNCH: 'Brunch',
    CAFE_CAFETERIA: 'Cafeterías',
    CAFE_PADARIA: 'Panaderías',
    CAFE_DOCERIA: 'Postres',
    CAFE_SORVETERIA: 'Heladerías',
    CAFE_CHA: 'Casas de té',
    CAFE_SUCOS: 'Jugos',
    MARKETS_FEIRA: 'Mercadillos',
    MARKETS_PRACA: 'Patios de comida',
    SPORTS_ACADEMIA: 'Gimnasios',
    SPORTS_QUADRA: 'Canchas y arenas',
    SPORTS_NATACAO: 'Natación',
    SPORTS_GOLFE: 'Golf',
    SPORTS_SKATE: 'Skate',
    ART_MUSEU: 'Museos',
    ART_GALERIA: 'Galerías y talleres',
    ART_CULTURAL: 'Centros culturales',
    FILM_CINEMA: 'Cine',
    FILM_TEATRO: 'Teatro',
    GAMING_FLIPERAMA: 'Arcades',
    GAMING_ESPORTS: 'E-sports',
    GAMING_TABULEIRO: 'Juegos de mesa',
    GAMING_RPG: 'Juegos de rol',
    OUTDOORS_PARQUE: 'Parques',
    OUTDOORS_TRILHA: 'Senderismo y camping',
    OUTDOORS_PRAIA: 'Playas',
    OUTDOORS_TURISMO: 'Lugares turísticos',
    BRECHO_GARIMPO: 'Vintage y segunda mano',
  },
  genres: {
    GENRE_SERTANEJO: 'Sertanejo',
    GENRE_FUNK: 'Funk brasileño',
    GENRE_PAGODE_SAMBA: 'Pagode y samba',
    GENRE_ROCK: 'Rock',
    GENRE_POP: 'Pop',
    GENRE_RAP: 'Rap y hip-hop',
    GENRE_FORRO: 'Forró',
    GENRE_PISEIRO: 'Piseiro',
    GENRE_AXE: 'Axé',
    GENRE_INDIE: 'Indie y alternativa',
    GENRE_HOUSE: 'House',
    GENRE_TECH_HOUSE: 'Tech house',
    GENRE_TECHNO: 'Techno',
    GENRE_PSYTRANCE: 'Psytrance',
    GENRE_DNB: 'Drum and bass',
    GENRE_EDM: 'EDM',
  },
  // 'rolê' vira 'plan' — é como se fala de sair em espanhol coloquial
  // ('hay plan hoy?'), muito mais natural que traduzir por 'evento'.
  notifications: {
    unknownActor: 'Alguien',
    followRequest: {
      title: 'Nueva solicitud',
      body: '{{actor}} quiere seguirte',
    },
    followAccepted: {
      title: 'Solicitud aceptada',
      body: '{{actor}} aceptó tu solicitud',
    },
    newFollower: {
      title: 'Nuevo seguidor',
      body: '{{actor}} empezó a seguirte',
    },
    eventInvite: {
      title: 'Invitación a un evento',
      body: '{{actor}} te invitó a un evento',
    },
    eventComment: {
      title: 'Nuevo comentario',
      body: '{{actor}} comentó en tu evento',
    },
    postComment: {
      title: 'Nuevo comentario',
      body: '{{actor}} comentó en tu post',
    },
    eventReaction: {
      title: 'Nuevo me gusta',
      body: 'A {{actor}} le gustó tu evento',
    },
    postReaction: {
      title: 'Nuevo me gusta',
      body: 'A {{actor}} le gustó tu post',
    },
    commentReaction: {
      title: 'Nuevo me gusta',
      body: 'A {{actor}} le gustó tu comentario',
    },
    eventAttendance: {
      title: 'Nueva asistencia',
      body: '{{actor}} va a tu evento',
    },
    eventNearby: {
      title: 'Hay un evento cerca',
      body: '{{eventTitle}}',
    },
    eventPromoted: {
      title: 'Destacado cerca de ti',
      body: '{{eventTitle}}',
    },
    spotNearby: {
      title: 'Hay plan cerca de ti',
      body: '{{spotTitle}}',
    },
    spotJoin: {
      title: 'Alguien se unió',
      body: '{{actor}} se unió a "{{spotTitle}}"',
    },
    spotRenewal: {
      title: 'Tu plan está por terminar',
      body: '"{{spotTitle}}" expira pronto — renuévalo por 24 h más',
    },
  },
  chatPush: {
    groupFallbackTitle: 'Grupo',
    groupBody: '{{sender}}: {{preview}}',
    emptyPreview: 'Nuevo mensaje',
    attachment: {
      IMAGE: '📷 Foto',
      AUDIO: '🎤 Mensaje de voz',
      VIDEO: '🎬 Video',
    },
  },
  emails: {
    passwordReset: {
      subject: '{{code}} es tu código de recuperación — Clubber',
      documentTitle: 'Tu código de recuperación — Clubber',
      preheader:
        'Tu código de recuperación es {{code}} — vale por {{duration}}.',
      heading: 'Vamos a recuperar tu cuenta',
      greeting:
        'Hola {{name}} — recibimos una solicitud para cambiar la contraseña de la cuenta ligada a este correo. Usa el código de abajo en la app para crear una nueva.',
      greetingText:
        'Hola {{name}} — recibimos una solicitud para cambiar la contraseña de la cuenta ligada a este correo.',
      codeLabel: 'Tu código',
      minutes_one: '{{count}} minuto',
      minutes_other: '{{count}} minutos',
      expiry:
        'El código vale por {{duration}} y se usa una sola vez. Escríbelo en la pantalla de recuperación de la app — nunca lo compartas con nadie.',
      notYou:
        '¿No fuiste tú? Ignora este correo — el código expira solo y tu contraseña sigue igual.',
      footerReason:
        'Recibiste este correo porque alguien pidió recuperar esta cuenta en Clubber.',
      helpCenter: 'Centro de ayuda',
    },
  },
}
