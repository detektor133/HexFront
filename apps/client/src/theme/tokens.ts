// Сгенерировано tools/tokens из docs/art/tokens.json — не редактировать вручную.

export const tokens = {
  "map": {
    "hexRadius": 20,
    "zoom": {
      "max": 2.5,
      "detailThresholds": [
        0.6,
        1.5
      ]
    },
    "background": "#BFD8EA",
    "water": "#8BD0EF",
    "waterEdge": "#9CC3E0",
    "river": "#8FBCE0",
    "riverWidth": [
      1.5,
      2.5,
      3.5
    ],
    "terrain": {
      "plains": "#F8F6EF",
      "forest": "#B3E0B1",
      "forestInk": "#6BA36B",
      "hills": "#DFE3B5",
      "hillInk": "#959A6B",
      "mountains": "#C3CAD0",
      "mountainInk": "#6B7983",
      "desert": "#FFE49F",
      "desertInk": "#D0A45C"
    },
    "patternWidth": 1.25,
    "hexGrid": "#FFFFFF",
    "hexGridAlpha": 0.45,
    "hexGridVisibleFromZoom": 2
  },
  "territory": {
    "fillMix": 0.62,
    "alphaOwn": 0.5,
    "alphaOther": 0.85,
    "borderWidth": [
      1.5,
      2.5,
      3.5
    ]
  },
  "players": {
    "palette": [
      {
        "id": "teal",
        "line": "#0E7C6B"
      },
      {
        "id": "brick",
        "line": "#B4432A"
      },
      {
        "id": "cobalt",
        "line": "#2757B8"
      },
      {
        "id": "mustard",
        "line": "#946A08"
      },
      {
        "id": "plum",
        "line": "#7B3F8C"
      },
      {
        "id": "forest",
        "line": "#3F7D2C"
      },
      {
        "id": "crimson",
        "line": "#B3263E"
      },
      {
        "id": "ocean",
        "line": "#1D7697"
      },
      {
        "id": "olive",
        "line": "#636A1C"
      },
      {
        "id": "rose",
        "line": "#AE4274"
      },
      {
        "id": "indigo",
        "line": "#3D4A9E"
      },
      {
        "id": "rust",
        "line": "#94561B"
      },
      {
        "id": "slate",
        "line": "#4F6475"
      },
      {
        "id": "magenta",
        "line": "#9E2C8C"
      },
      {
        "id": "pine",
        "line": "#1E6B4A"
      },
      {
        "id": "amber",
        "line": "#A9580A"
      },
      {
        "id": "navy",
        "line": "#243B6B"
      },
      {
        "id": "wine",
        "line": "#7E2A3E"
      },
      {
        "id": "moss",
        "line": "#557526"
      },
      {
        "id": "cyan",
        "line": "#0B7F8E"
      },
      {
        "id": "orchid",
        "line": "#7F4DAD"
      },
      {
        "id": "cocoa",
        "line": "#6B4A3A"
      },
      {
        "id": "steel",
        "line": "#3B6A8A"
      },
      {
        "id": "scarlet",
        "line": "#B8381F"
      }
    ],
    "minContrastOnWhite": 4.5
  },
  "neutral": {
    "line": "#8A8880",
    "fill": "#E4E2DB",
    "road": "#B4B2A9",
    "roadWidth": [
      2,
      4,
      6
    ]
  },
  "road": {
    "width": [
      2,
      3,
      4
    ],
    "dash": [
      6,
      5
    ],
    "cornerRadius": 6,
    "flowColor": "#FFFFFF",
    "flowWidth": [
      1.5,
      2.5,
      3.5
    ],
    "flowDash": [
      2,
      14
    ],
    "flowSpeed": 18,
    "isolatedAlpha": 0.45,
    "offroadDotted": [
      1,
      5
    ]
  },
  "city": {
    "radiusByLevel": [
      6,
      7.5,
      9,
      10.5,
      12
    ],
    "strokeByLevel": [
      3,
      3.5,
      4,
      4.5,
      5
    ],
    "fill": "#FFFFFF",
    "capitalDotRadius": 3,
    "capitalOuterRingGap": 3,
    "capitalOuterRingWidth": 1.25,
    "labelSize": [
      11,
      11,
      13
    ],
    "labelHalo": 3
  },
  "front": {
    "width": [
      4,
      6,
      8
    ],
    "casing": "#FFFFFF",
    "casingWidth": 2
  },
  "arrow": {
    "width": [
      8,
      11,
      14
    ],
    "alpha": 0.85,
    "headLength": 16,
    "headWidth": 22
  },
  "fog": {
    "hatch": "#22211E",
    "hatchAlpha": 0.08,
    "hatchSpacing": 6,
    "hatchWidth": 1,
    "memoryAlpha": 0.5
  },
  "ui": {
    "ink": "#22211E",
    "ink2": "#5B5A55",
    "ink3": "#8C8A83",
    "surface": "#FFFFFF",
    "surface2": "#F6F5F1",
    "border": "#D9D7CF",
    "borderStrong": "#B9B7AE",
    "buttonPrimaryBg": "#22211E",
    "buttonPrimaryInk": "#FFFFFF"
  },
  "status": {
    "success": "#2E7D4F",
    "successBg": "#E3F1E8",
    "warning": "#A8680F",
    "warningBg": "#FBEFD9",
    "danger": "#C23B22",
    "dangerBg": "#FBE6E1",
    "lowSupply": "#D08A16",
    "encircled": "#C23B22"
  },
  "font": {
    "display": {
      "family": "Unbounded",
      "weight": 500,
      "files": "fonts/unbounded-500-{latin,cyrillic}.woff2"
    },
    "ui": {
      "family": "Golos Text",
      "weights": [
        400,
        500
      ],
      "files": "fonts/golos-text-{400,500}-{latin,cyrillic}.woff2"
    },
    "size": {
      "caption": 12,
      "body": 14,
      "label": 13,
      "title": 18,
      "hudValue": 15,
      "display": 24
    },
    "numeric": "tabular-nums"
  },
  "radius": {
    "chip": 6,
    "button": 8,
    "card": 12,
    "input": 8
  },
  "space": {
    "xs": 4,
    "sm": 8,
    "md": 12,
    "lg": 16,
    "xl": 24
  },
  "touchTargetMin": 44,
  "shadow": {
    "hard": "0 2px 0 rgba(34,33,30,0.14)"
  },
  "motion": {
    "ui": 150,
    "map": 250,
    "capture": 300,
    "easing": "cubic-bezier(0.22, 1, 0.36, 1)"
  }
} as const;
