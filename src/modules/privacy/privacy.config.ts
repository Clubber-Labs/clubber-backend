import {
  PRIVACY_POLICY_VERSION,
  PRIVACY_TERMS_VERSION,
  type PrivacyPurposeKey,
} from './privacy.schema'

export type PrivacyPurposeConfig = {
  key: PrivacyPurposeKey
  label: string
  description: string
  required: boolean
  defaultGranted: boolean
  legalBasis: string
}

export const PRIVACY_PURPOSES: PrivacyPurposeConfig[] = [
  {
    key: 'terms_privacy_required',
    label: 'Termos de Uso e Política de Privacidade',
    description:
      'Registra o aceite obrigatório para criação e uso da conta ConnectAI.',
    required: true,
    defaultGranted: false,
    legalBasis: 'execução de contrato e transparência',
  },
  {
    key: 'location_precise_nearby',
    label: 'Localização precisa para eventos próximos',
    description:
      'Permite usar GPS em primeiro plano para centralizar mapa e enviar nearLat/nearLng ao feed.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'location_manual_or_approx',
    label: 'Localização aproximada ou manual',
    description:
      'Permite usar cidade, bairro ou posição aproximada sem GPS preciso.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'feed_social_personalization',
    label: 'Personalização social do feed',
    description:
      'Usa amigos, confirmações, curtidas, comentários e preferências para ordenar recomendações.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'social_activity_visibility',
    label: 'Visibilidade das minhas interações sociais',
    description:
      'Permite que confirmações e interações apareçam como sinais sociais para amigos.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'push_event_updates',
    label: 'Notificações de eventos e convites',
    description:
      'Permite registrar token push e enviar avisos de eventos, convites, comentários e alterações.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'marketing_premium',
    label: 'Novidades, pesquisas e ofertas premium',
    description:
      'Permite comunicações comerciais e convites opcionais de pesquisa.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'analytics_product',
    label: 'Métricas de uso para melhoria do app',
    description:
      'Permite métricas identificáveis de uso, desempenho e conversão; dados agregados devem ser preferidos.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
  {
    key: 'research_feedback',
    label: 'Pesquisas do projeto ConnectAI',
    description:
      'Permite convites e respostas voluntárias para validação acadêmica/produto.',
    required: false,
    defaultGranted: false,
    legalBasis: 'consentimento',
  },
]

export const REQUIRED_PRIVACY_PURPOSES = PRIVACY_PURPOSES.filter(
  (purpose) => purpose.required,
)

export function getPrivacyConfig() {
  return {
    policyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: PRIVACY_TERMS_VERSION,
    purposes: PRIVACY_PURPOSES,
  }
}
