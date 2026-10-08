export interface UnitLayerCacheTelemetry {
  readonly shown: number;
  readonly drawnAt: number;
  readonly chips: number;
  readonly encircledSince: number;
}

export interface EconomyLayerCacheTelemetry {
  readonly capturesByHex: number;
  readonly cityFlashes: number;
}

export interface FrontTweenCacheTelemetry {
  readonly byArmy: number;
}
