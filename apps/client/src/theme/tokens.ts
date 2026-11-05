// Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.

export const tokens = {
  map: {
    hexRadius: 20,
    zoom: {
      max: 2.5,
      detailThresholds: [0.6, 1.5],
    },
    background: '#4F86A8',
    water: '#5B94B8',
    waterEdge: '#4A7FA3',
    river: '#4A7FA3',
    riverWidth: [1.5, 2.5, 3.5],
    terrain: {
      plains: '#A9CB78',
      plainsInk: '#6F9A47',
      forest: '#59B35F',
      forestInk: '#23592E',
      hills: '#BDB276',
      hillInk: '#7A7442',
      mountains: '#A0A8AE',
      mountainInk: '#515F69',
      desert: '#E2C47A',
      desertInk: '#A98239',
    },
    patternWidth: 1.25,
    hexGrid: '#FFFFFF',
    hexGridAlpha: 0.45,
    hexGridVisibleFromZoom: 2,
  },
  territory: {
    fillMix: 0.3,
    alphaOwn: 0.5,
    alphaOther: 0.85,
    borderWidth: [1.5, 1.5, 1.5],
  },
  players: {
    palette: [
      {
        id: 'teal',
        line: '#0E7C6B',
      },
      {
        id: 'berry',
        line: '#7E2256',
      },
      {
        id: 'bronze',
        line: '#814E11',
      },
      {
        id: 'cobalt',
        line: '#1B6BCF',
      },
      {
        id: 'scarlet',
        line: '#D1282E',
      },
      {
        id: 'fern',
        line: '#2E4F00',
      },
      {
        id: 'violet',
        line: '#9748C5',
      },
      {
        id: 'indigo',
        line: '#3A3F86',
      },
      {
        id: 'olive',
        line: '#756F1C',
      },
      {
        id: 'brick',
        line: '#7D2C1B',
      },
      {
        id: 'fuchsia',
        line: '#D40078',
      },
      {
        id: 'grass',
        line: '#407B0E',
      },
      {
        id: 'purple',
        line: '#741193',
      },
      {
        id: 'garnet',
        line: '#9B3648',
      },
      {
        id: 'copper',
        line: '#B2501B',
      },
      {
        id: 'lavender',
        line: '#6D63AE',
      },
      {
        id: 'emerald',
        line: '#0D6731',
      },
      {
        id: 'mauve',
        line: '#A1518C',
      },
      {
        id: 'grape',
        line: '#74478C',
      },
      {
        id: 'raspberry',
        line: '#D8074F',
      },
      {
        id: 'azure',
        line: '#2D4DC9',
      },
      {
        id: 'ochre',
        line: '#8C671E',
      },
      {
        id: 'magenta',
        line: '#A20E94',
      },
      {
        id: 'crimson',
        line: '#B11909',
      },
      {
        id: 'amethyst',
        line: '#693FBB',
      },
      {
        id: 'rose',
        line: '#B14A69',
      },
      {
        id: 'mustard',
        line: '#6D5703',
      },
      {
        id: 'rust',
        line: '#8D4520',
      },
      {
        id: 'moss',
        line: '#52600B',
      },
      {
        id: 'coral',
        line: '#B04E4C',
      },
    ],
    minContrastOnWhite: 4.5,
  },
  neutral: {
    line: '#8A8880',
    fill: '#E4E2DB',
    road: '#B4B2A9',
    roadWidth: [2, 4, 6],
  },
  road: {
    width: [2, 3, 4],
    dash: [6, 5],
    cornerRadius: 6,
    isolatedAlpha: 0.45,
    offroadDotted: [1, 5],
  },
  city: {
    sizeByLevel: [0.36, 0.44, 0.52, 0.6, 0.68],
    outline: 1.5,
    capitalStarOuter: 0.62,
    capitalStarInner: 0.27,
    fill: '#FFFFFF',
    labelSize: [11, 11, 13],
    labelHalo: 3,
  },
  construction: {
    size: 0.36,
    improvementSize: 0.22,
    outline: 1.5,
    fill: '#FFFFFF',
  },
  relation: {
    own: '#2E7D32',
    ally: '#1F5FB8',
    enemy: '#C62828',
  },
  armies: {
    palette: ['#7B3F8C', '#0B7F8E', '#9E2C8C', '#4F6475', '#946A08', '#636A1C', '#94561B'],
    defenseTeeth: {
      length: 5,
      spacing: 12,
    },
  },
  front: {
    width: [2.5, 3, 3.5],
    casing: '#FFFFFF',
    casingWidth: 1.5,
    handleRadius: 7,
    tickLength: 5,
    tickSpacing: 10,
    tickWidth: 1.5,
  },
  arrow: {
    color: '#E8590C',
    width: [2.5, 3, 3.5],
    dash: [8, 5],
    alpha: 0.6,
    plannedAlpha: 0.25,
    bodyWidth: 0.42,
    headLength: 0.7,
    headWidth: 1,
  },
  selection: {
    color: '#C99A2E',
    width: 2.5,
  },
  chip: {
    org: '#2E7D4F',
    supply: '#3A6EA5',
    track: '#E4E2DA',
  },
  fog: {
    hatch: '#22211E',
    hatchAlpha: 0.08,
    hatchSpacing: 6,
    hatchWidth: 1,
    memoryAlpha: 0.5,
    dark: '#080D14',
    darkAlpha: 0.74,
    soft: 0.5,
  },
  ui: {
    ink: '#22211E',
    ink2: '#5B5A55',
    ink3: '#8C8A83',
    surface: '#FFFFFF',
    surface2: '#F6F5F1',
    border: '#D9D7CF',
    borderStrong: '#B9B7AE',
    buttonPrimaryBg: '#22211E',
    buttonPrimaryInk: '#FFFFFF',
  },
  status: {
    success: '#2E7D4F',
    successBg: '#E3F1E8',
    warning: '#A8680F',
    warningBg: '#FBEFD9',
    danger: '#C23B22',
    dangerBg: '#FBE6E1',
    lowSupply: '#D08A16',
    encircled: '#C23B22',
  },
  font: {
    display: {
      family: 'Unbounded',
      weight: 500,
      files: 'fonts/unbounded-500-{latin,cyrillic}.woff2',
    },
    ui: {
      family: 'Golos Text',
      weights: [400, 500],
      files: 'fonts/golos-text-{400,500}-{latin,cyrillic}.woff2',
    },
    size: {
      caption: 12,
      body: 14,
      label: 13,
      title: 18,
      hudValue: 15,
      display: 24,
    },
    numeric: 'tabular-nums',
  },
  radius: {
    chip: 6,
    button: 8,
    card: 12,
    input: 8,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  touchTargetMin: 44,
  shadow: {
    hard: '0 2px 0 rgba(34,33,30,0.14)',
  },
  motion: {
    ui: 150,
    map: 250,
    capture: 300,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
} as const;
