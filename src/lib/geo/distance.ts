const EARTH_RADIUS_M = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Distância em metros (inteiros) entre dois pontos via fórmula de Haversine.
 * Usada para anexar `distanceMeters` aos candidatos efêmeros do Places (que não
 * passam pelo PostGIS), dando à camada de IA o sinal de proximidade.
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(EARTH_RADIUS_M * c)
}
