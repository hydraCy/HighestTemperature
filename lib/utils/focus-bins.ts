export function buildFocusBins(centerTemp: number): string[] {
  const c = Math.round(centerTemp);
  return [
    `<=${c - 3}°C`,
    `${c - 2}°C`,
    `${c - 1}°C`,
    `${c}°C`,
    `${c + 1}°C`,
    `${c + 2}°C`,
    `>=${c + 3}°C`
  ];
}

