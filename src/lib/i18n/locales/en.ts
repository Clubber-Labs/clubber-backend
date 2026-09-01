import type { Dictionary } from '../dictionary'

// Copy adaptada, não traduzida ao pé da letra: rótulos como um app de vida
// noturna em inglês escreveria (ex.: 'Balada' → 'Clubbing', 'Funk' → 'Baile
// funk' — em inglês, "funk" sozinho remete ao gênero americano).
export const en: Dictionary = {
  categories: {
    MUSIC: 'Music',
    SPORTS: 'Sports',
    TECH: 'Tech',
    GASTRONOMY: 'Food',
    CAFE: 'Cafés',
    ART: 'Art',
    EDUCATION: 'Learning',
    NIGHTLIFE: 'Nightlife',
    BUSINESS: 'Business',
    HEALTH_WELLNESS: 'Wellness',
    OUTDOORS: 'Outdoors',
    GAMING: 'Games',
    FILM_THEATER: 'Movies & theater',
    COMEDY: 'Comedy',
    FASHION: 'Fashion',
    MARKETS: 'Markets & pop-ups',
    RELIGION: 'Religion',
    FAMILY: 'Family',
    PETS: 'Pet-friendly',
    VOLUNTEERING: 'Volunteering',
    PARTY: 'Parties',
    OTHER: 'Other',
    BRECHO: 'Thrifting',
    FESTIVAL: 'Festivals',
  },
  subcategories: {
    NIGHTLIFE_BALADA: 'Clubbing',
    PARTY_DANCA: 'Dancing',
    NIGHTLIFE_BAR: 'Bars',
    NIGHTLIFE_PUB: 'Pubs',
    NIGHTLIFE_VINHO: 'Wine bars',
    MUSIC_SHOW: 'Live music',
    MUSIC_KARAOKE: 'Karaoke',
    GASTRONOMY_RESTAURANTE: 'Restaurants',
    GASTRONOMY_PIZZA: 'Pizza',
    GASTRONOMY_JAPONESA: 'Sushi & Japanese',
    GASTRONOMY_CHURRASCO: 'Steak & BBQ',
    GASTRONOMY_BRUNCH: 'Brunch',
    CAFE_CAFETERIA: 'Coffee shops',
    CAFE_PADARIA: 'Bakeries',
    CAFE_DOCERIA: 'Desserts',
    CAFE_SORVETERIA: 'Ice cream',
    CAFE_CHA: 'Tea houses',
    CAFE_SUCOS: 'Juice bars',
    MARKETS_FEIRA: 'Street markets',
    MARKETS_PRACA: 'Food halls',
    SPORTS_ACADEMIA: 'Gyms',
    SPORTS_QUADRA: 'Courts & arenas',
    SPORTS_NATACAO: 'Swimming',
    SPORTS_GOLFE: 'Golf',
    SPORTS_SKATE: 'Skateboarding',
    ART_MUSEU: 'Museums',
    ART_GALERIA: 'Galleries & studios',
    ART_CULTURAL: 'Cultural centers',
    FILM_CINEMA: 'Movies',
    FILM_TEATRO: 'Theater',
    GAMING_FLIPERAMA: 'Arcades',
    GAMING_ESPORTS: 'E-sports',
    GAMING_TABULEIRO: 'Board games',
    GAMING_RPG: 'Tabletop RPGs',
    OUTDOORS_PARQUE: 'Parks',
    OUTDOORS_TRILHA: 'Hiking & camping',
    OUTDOORS_PRAIA: 'Beaches',
    OUTDOORS_TURISMO: 'Sightseeing',
    BRECHO_GARIMPO: 'Thrift & vintage',
  },
  genres: {
    GENRE_SERTANEJO: 'Sertanejo',
    GENRE_FUNK: 'Baile funk',
    GENRE_PAGODE_SAMBA: 'Pagode & samba',
    GENRE_ROCK: 'Rock',
    GENRE_POP: 'Pop',
    GENRE_RAP: 'Rap & hip-hop',
    GENRE_FORRO: 'Forró',
    GENRE_PISEIRO: 'Piseiro',
    GENRE_AXE: 'Axé',
    GENRE_INDIE: 'Indie & alternative',
    GENRE_HOUSE: 'House',
    GENRE_TECH_HOUSE: 'Tech house',
    GENRE_TECHNO: 'Techno',
    GENRE_PSYTRANCE: 'Psytrance',
    GENRE_DNB: 'Drum and bass',
    GENRE_EDM: 'EDM',
  },
  // 'rolê' vira 'hangout' em todas as chaves de spot: 'spot' em inglês soa a
  // lugar, não a encontro, e é o termo casual que essa faixa etária usa.
  notifications: {
    unknownActor: 'Someone',
    followRequest: {
      title: 'New request',
      body: '{{actor}} wants to follow you',
    },
    followAccepted: {
      title: 'Request accepted',
      body: '{{actor}} accepted your follow request',
    },
    newFollower: {
      title: 'New follower',
      body: '{{actor}} started following you',
    },
    eventInvite: {
      title: 'Event invite',
      body: '{{actor}} invited you to an event',
    },
    eventComment: {
      title: 'New comment',
      body: '{{actor}} commented on your event',
    },
    postComment: {
      title: 'New comment',
      body: '{{actor}} commented on your post',
    },
    commentReply: {
      title: 'New reply',
      body: '{{actor}} replied to your comment',
    },
    eventReaction: {
      title: 'New like',
      body: '{{actor}} liked your event',
    },
    postReaction: {
      title: 'New like',
      body: '{{actor}} liked your post',
    },
    commentReaction: {
      title: 'New like',
      body: '{{actor}} liked your comment',
    },
    eventAttendance: {
      title: 'New RSVP',
      body: '{{actor}} is going to your event',
    },
    eventNearby: {
      title: 'Event near you',
      body: '{{eventTitle}}',
    },
    eventPromoted: {
      title: 'Featured near you',
      body: '{{eventTitle}}',
    },
    spotNearby: {
      title: 'Hangout near you',
      body: '{{spotTitle}}',
    },
    spotJoin: {
      title: 'Someone joined',
      body: '{{actor}} joined "{{spotTitle}}"',
    },
    spotRenewal: {
      title: 'Your hangout is ending',
      body: '"{{spotTitle}}" expires soon — renew it for another 24h',
    },
  },
  chatPush: {
    groupFallbackTitle: 'Group',
    groupBody: '{{sender}}: {{preview}}',
    emptyPreview: 'New message',
    attachment: {
      IMAGE: '📷 Photo',
      AUDIO: '🎤 Voice message',
      VIDEO: '🎬 Video',
    },
  },
  emails: {
    passwordReset: {
      subject: '{{code}} is your recovery code — Clubber',
      documentTitle: 'Your recovery code — Clubber',
      preheader: 'Your recovery code is {{code}} — good for {{duration}}.',
      heading: "Let's get you back in",
      greeting:
        'Hey {{name}} — someone asked to reset the password for the account linked to this email. Use the code below in the app to set a new one.',
      greetingText:
        'Hi {{name}} — someone asked to reset the password for the account linked to this email.',
      codeLabel: 'Your code',
      minutes_one: '{{count}} minute',
      minutes_other: '{{count}} minutes',
      expiry:
        'The code lasts {{duration}} and works only once. Type it on the recovery screen in the app — never share it with anyone.',
      notYou:
        "Wasn't you? Just ignore this email — the code expires on its own and your password stays the same.",
      footerReason:
        'You got this email because someone asked to recover this Clubber account.',
      helpCenter: 'Help center',
    },
  },
  spots: {
    suggestionFallbackTitle: 'Down for {{name}}?',
  },
}
