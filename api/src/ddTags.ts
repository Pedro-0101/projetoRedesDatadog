// Tags Datadog compartilhadas entre os modulos SDN/QoS/Flow/Shaping.
// Centraliza o env tag (antes 'env:dev' hardcoded em cada arquivo) e monta o
// conjunto base de tags de forma consistente, permitindo slice-and-dice
// confiavel no Datadog (env + dimensoes especificas como worker/priority/etc).
export const ENV_TAG = `env:${process.env.DD_ENV || 'dev'}`;

// Retorna [ENV_TAG, ...extra]. Use sempre que emitir uma metrica DogStatsD.
export function baseTags(...extra: string[]): string[] {
  return [ENV_TAG, ...extra];
}
