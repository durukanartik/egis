// Color system for charts, following the dataviz method: color is assigned by job
// (categorical/ordinal/status), never hand-picked per chart.
//
// Categorical slots are the dataviz skill's validated default palette, used unmodified in
// fixed order — it clears every CVD/contrast gate for up to 8 series, which covers every
// nominal chart in this app (sector, application status).
export const CATEGORICAL = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
];

// Status palette (fixed, reserved meaning) — for data that IS a good/bad state, such as
// licence status. Never reused for plain series identity.
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

// Ordinal ramp (one hue, monotone lightness) for classification tier — Basic -> Advanced ->
// Premium is a meaningful order, so it takes a single-hue ramp (EAD Environment Green) rather
// than unrelated categorical hues. Light end still clears 2:1 contrast.
export const TIER_ORDINAL: Record<string, string> = {
  Basic: "#9ecbb3",
  Advanced: "#2f9d6e",
  Premium: "#00613c",
};

export const LICENCE_STATUS_COLOR: Record<string, string> = {
  active: STATUS.good,
  expired: STATUS.warning,
  suspended: STATUS.critical,
  revoked: STATUS.serious,
};

export const CHART_INK = {
  primaryText: "#0b0b0b",
  secondaryText: "#52514e",
  mutedText: "#898781",
  grid: "#e1e0d9",
};
