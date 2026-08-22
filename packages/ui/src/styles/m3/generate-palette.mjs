// Generator for the M3 tonal palettes used by tokens.ts / tokens.css.
//
// Run from the repository root:
//   node packages/ui/src/styles/m3/generate-palette.mjs
//
// The seed is the app's existing accent color (#0f766e, the teal used by
// --primary in styles/globals.css), so the Material 3 scheme stays visually
// continuous with the current chrome instead of shipping a generic baseline.
//
// Tones are true Material tones (CIE L*). For each tone we solve for the
// OKLab lightness whose relative luminance matches the CIE L* target, then
// reduce chroma until the color fits sRGB gamut. That keeps every generated
// pair (for example primary/onPrimary at tones 40/100) inside the contrast
// guarantees the M3 role mapping promises.

const SEED = { hex: "#0f766e", name: "primary" };
const ERROR_SEED = { hex: "#c3342d", name: "error" };

const TONES = [
  0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95,
  96, 98, 99, 100
];

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function linearRgbToXyz(rgb) {
  return [
    0.4123907993 * rgb[0] + 0.3575843394 * rgb[1] + 0.1804807884 * rgb[2],
    0.2126390059 * rgb[0] + 0.7151686788 * rgb[1] + 0.0721923154 * rgb[2],
    0.0193308187 * rgb[0] + 0.1191947798 * rgb[1] + 0.9505321522 * rgb[2]
  ];
}

function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}

function rgbToOklch(hex) {
  const rgb = hexToRgb(hex).map(srgbToLinear);
  const xyz = linearRgbToXyz(rgb);
  const l = Math.cbrt(0.8189330101 * xyz[0] + 0.3618667424 * xyz[1] - 0.1288597137 * xyz[2]);
  const m = Math.cbrt(0.0329845436 * xyz[0] + 0.9293118715 * xyz[1] + 0.0361456387 * xyz[2]);
  const s = Math.cbrt(0.0482003018 * xyz[0] + 0.2643662691 * xyz[1] + 0.633851707 * xyz[2]);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) {
    H += 360;
  }
  return { L, C, H };
}

function luminance(linearRgb) {
  return 0.2126 * linearRgb[0] + 0.7152 * linearRgb[1] + 0.0722 * linearRgb[2];
}

function inGamut(linearRgb) {
  return linearRgb.every((c) => c >= -0.0005 && c <= 1.0005);
}

// Render one tone. When the requested chroma barely misses sRGB gamut
// (near-black neutrals, for instance), prefer clipping over chroma loss so
// very dark surfaces keep the seed's hue instead of collapsing to pure grey.
function toneColor(L, hue, requested) {
  const rad = (hue * Math.PI) / 180;
  const direct = oklabToLinearSrgb(L, requested * Math.cos(rad), requested * Math.sin(rad));
  if (inGamut(direct)) {
    return direct;
  }
  const overshoot = Math.max(...direct.map((c) => Math.max(-c, c - 1)));
  if (overshoot <= 0.02) {
    return direct;
  }
  const fitted = fitChroma(L, hue, requested);
  return oklabToLinearSrgb(L, fitted * Math.cos(rad), fitted * Math.sin(rad));
}

// Largest chroma <= requested that fits sRGB at this lightness/hue.
function fitChroma(L, hue, requested) {
  const rad = (hue * Math.PI) / 180;
  const aUnit = Math.cos(rad);
  const bUnit = Math.sin(rad);
  let low = 0;
  let high = requested;
  if (inGamut(oklabToLinearSrgb(L, high * aUnit, high * bUnit))) {
    return high;
  }
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (inGamut(oklabToLinearSrgb(L, mid * aUnit, mid * bUnit))) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

// CIE L* (the M3 "tone") -> relative luminance against D65.
// Piecewise per CIE: Y = fy^3 above the knee, otherwise Y = L* / kappa.
const KAPPA = 903.2962962962963;
const EPSILON = 216 / 24389;

function toneToY(tone) {
  const fy = (tone + 16) / 116;
  const y = fy ** 3;
  return y > EPSILON ? y : tone / KAPPA;
}

// Solve OKLab lightness so the color's relative luminance equals the tone's.
function lightnessForTone(tone, hue, chromaTarget) {
  const targetY = toneToY(tone);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const chroma = fitChroma(mid, hue, chromaTarget);
    const rad = (hue * Math.PI) / 180;
    const y = luminance(oklabToLinearSrgb(mid, chroma * Math.cos(rad), chroma * Math.sin(rad)));
    if (y < targetY) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function buildPalette(seedHex) {
  const seed = rgbToOklch(seedHex);
  const palettes = {};
  const definitions = [
    ["primary", seed.H, seed.C],
    ["secondary", seed.H, seed.C / 3],
    ["tertiary", (seed.H + 55) % 360, seed.C * 0.8],
    ["neutral", seed.H, 0.006],
    ["neutralVariant", seed.H, 0.012],
    ["error", rgbToOklch(ERROR_SEED.hex).H, Math.max(rgbToOklch(ERROR_SEED.hex).C, 0.09)]
  ];
  for (const [name, hue, chroma] of definitions) {
    palettes[name] = {};
    for (const tone of TONES) {
      const L = lightnessForTone(tone, hue, chroma);
      const linear = toneColor(L, hue, chroma).map((c) => linearToSrgbChannel(Math.min(1, Math.max(0, c))));
      palettes[name][tone] =
        "#" +
        linear
          .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase();
    }
  }
  return palettes;
}

function contrastRatio(foregroundHex, backgroundHex) {
  const lum = (hex) =>
    luminance(hexToRgb(hex).map(srgbToLinear));
  const a = lum(foregroundHex);
  const b = lum(backgroundHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const SCHEMES = {
  light: {
    primary: ["primary", 40], onPrimary: ["primary", 100], primaryContainer: ["primary", 90], onPrimaryContainer: ["primary", 10],
    secondary: ["secondary", 40], onSecondary: ["secondary", 100], secondaryContainer: ["secondary", 90], onSecondaryContainer: ["secondary", 10],
    tertiary: ["tertiary", 40], onTertiary: ["tertiary", 100], tertiaryContainer: ["tertiary", 90], onTertiaryContainer: ["tertiary", 10],
    error: ["error", 40], onError: ["error", 100], errorContainer: ["error", 90], onErrorContainer: ["error", 10],
    background: ["neutral", 98], onBackground: ["neutral", 10],
    surface: ["neutral", 98], onSurface: ["neutral", 10],
    surfaceVariant: ["neutralVariant", 90], onSurfaceVariant: ["neutralVariant", 30],
    outline: ["neutralVariant", 50], outlineVariant: ["neutralVariant", 80],
    shadow: ["neutral", 0], scrim: ["neutral", 0],
    inverseSurface: ["neutral", 20], inverseOnSurface: ["neutral", 95], inversePrimary: ["primary", 80],
    surfaceDim: ["neutral", 87], surfaceBright: ["neutral", 98],
    surfaceContainerLowest: ["neutral", 100], surfaceContainerLow: ["neutral", 96],
    surfaceContainer: ["neutral", 94], surfaceContainerHigh: ["neutral", 92],
    surfaceContainerHighest: ["neutral", 90]
  },
  dark: {
    primary: ["primary", 80], onPrimary: ["primary", 20], primaryContainer: ["primary", 30], onPrimaryContainer: ["primary", 90],
    secondary: ["secondary", 80], onSecondary: ["secondary", 20], secondaryContainer: ["secondary", 30], onSecondaryContainer: ["secondary", 90],
    tertiary: ["tertiary", 80], onTertiary: ["tertiary", 20], tertiaryContainer: ["tertiary", 30], onTertiaryContainer: ["tertiary", 90],
    error: ["error", 80], onError: ["error", 20], errorContainer: ["error", 30], onErrorContainer: ["error", 90],
    background: ["neutral", 6], onBackground: ["neutral", 90],
    surface: ["neutral", 6], onSurface: ["neutral", 90],
    surfaceVariant: ["neutralVariant", 30], onSurfaceVariant: ["neutralVariant", 80],
    outline: ["neutralVariant", 60], outlineVariant: ["neutralVariant", 30],
    shadow: ["neutral", 0], scrim: ["neutral", 0],
    inverseSurface: ["neutral", 90], inverseOnSurface: ["neutral", 20], inversePrimary: ["primary", 40],
    surfaceDim: ["neutral", 6], surfaceBright: ["neutral", 24],
    surfaceContainerLowest: ["neutral", 4], surfaceContainerLow: ["neutral", 10],
    surfaceContainer: ["neutral", 12], surfaceContainerHigh: ["neutral", 17],
    surfaceContainerHighest: ["neutral", 22]
  }
};

function renderScheme(palettes, mode) {
  const roles = SCHEMES[mode];
  const lines = [];
  for (const [role, [palette, tone]] of Object.entries(roles)) {
    lines.push(`${role}: "${palettes[palette][tone]}"`);
  }
  return lines.join(",\n");
}

const palettes = buildPalette(SEED.hex);

console.log(`// Seed ${SEED.hex} (hue ${rgbToOklch(SEED.hex).H.toFixed(1)}, chroma ${rgbToOklch(SEED.hex).C.toFixed(3)})`);
console.log("\n/* LIGHT */");
console.log(renderScheme(palettes, "light"));
console.log("\n/* DARK */");
console.log(renderScheme(palettes, "dark"));

console.log("\n/* CONTRAST CHECKS (WCAG ratio) */");
for (const mode of ["light", "dark"]) {
  const resolve = (role) => {
    const [palette, tone] = SCHEMES[mode][role];
    return palettes[palette][tone];
  };
  const pairs = [
    ["primary/onPrimary", "primary", "onPrimary"],
    ["onSurface/surface", "onSurface", "surface"],
    ["onSurfaceVariant/surface", "onSurfaceVariant", "surface"],
    ["onBackground/background", "onBackground", "background"],
    ["outline/surface", "outline", "surface"],
    ["onError/error", "onError", "error"]
  ];
  for (const [label, fg, bg] of pairs) {
    console.log(`${mode} ${label}: ${contrastRatio(resolve(bg), resolve(fg)).toFixed(2)}:1`);
  }
}
