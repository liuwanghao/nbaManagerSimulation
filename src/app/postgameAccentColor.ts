const POSTGAME_BACKGROUND = [16, 24, 42];

function relativeLuminance(channels: number[]): number {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

const backgroundLuminance = relativeLuminance(POSTGAME_BACKGROUND);

export function postgameAccentColor(primaryColor: string): string {
  const hex = /^#([\da-f]{6})$/iu.exec(primaryColor)?.[1];
  if (!hex) return "#00e7f4";
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  for (let step = 0; step <= 20; step++) {
    const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * step / 20));
    if ((relativeLuminance(mixed) + 0.05) / (backgroundLuminance + 0.05) >= 7) {
      return step === 0 ? primaryColor : `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#ffffff";
}
