import { readFileSync } from 'node:fs';

import { expect } from 'vitest';

import armyStyles from '../src/dev/ArmyBar.module.css';
import cardStyles from '../src/dev/HexCard.module.css';
import leaderboardStyles from '../src/dev/Leaderboard.module.css';

/** Подключает исходные правила к тем же классам, которые выдаёт Vitest для CSS-модулей. */
export function installPanelStyles(): () => void {
  const sheets = [
    ['ArmyBar', armyStyles],
    ['HexCard', cardStyles],
    ['Leaderboard', leaderboardStyles],
  ] as const;
  const tokens = readFileSync('apps/client/src/theme/tokens.css', 'utf8');
  const variables = new Map(
    [...tokens.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2]]),
  );
  const nodes = sheets.map(([name, classes]) => {
    const node = document.createElement('style');
    node.textContent = readFileSync(`apps/client/src/dev/${name}.module.css`, 'utf8')
      .replace(/\.([a-zA-Z_][\w-]*)/gu, (selector, local: string) =>
        classes[local] ? `.${classes[local]}` : selector,
      )
      .replace(
        /var\((--[\w-]+)\)/gu,
        (value, variable: string) => variables.get(variable) ?? value,
      );
    document.head.append(node);
    return node;
  });
  return () => nodes.forEach((node) => node.remove());
}

/** jsdom возвращает duration=0s даже при shorthand «top 1s»; читаем применённые объявления CSSOM. */
export function expectNoGeometryTransition(node: HTMLElement): void {
  let transition = '';
  let transitionProperty = '';
  let transitionDuration = '';
  const mediaQueryApplies = (query: string, width: number): boolean => {
    const minWidth = query.match(/\(\s*min-width\s*:\s*([\d.]+)px\s*\)/u);
    const maxWidth = query.match(/\(\s*max-width\s*:\s*([\d.]+)px\s*\)/u);
    const minimum = minWidth ? Number.parseFloat(minWidth[1] ?? '') : 0;
    const maximum = maxWidth ? Number.parseFloat(maxWidth[1] ?? '') : Number.POSITIVE_INFINITY;
    return width >= minimum && width <= maximum;
  };
  const collectDeclarations = (rules: CSSRuleList): CSSStyleDeclaration[] =>
    Array.from(rules).flatMap((rule) => {
      if (rule instanceof CSSStyleRule) {
        return node.matches(rule.selectorText) ? [rule.style] : [];
      }
      if (rule instanceof CSSMediaRule) {
        const applies = rule.media.mediaText
          .split(',')
          .some((query) => mediaQueryApplies(query, window.innerWidth));
        if (!applies) return [];
      }
      return 'cssRules' in rule
        ? collectDeclarations((rule as { readonly cssRules: CSSRuleList }).cssRules)
        : [];
    });
  const declarations = Array.from(document.styleSheets).flatMap((sheet) =>
    collectDeclarations(sheet.cssRules),
  );
  for (const style of [...declarations, node.style]) {
    for (let index = 0; index < style.length; index += 1) {
      const property = style[index];
      if (property === 'transition') {
        transition = style.getPropertyValue(property);
        transitionProperty = '';
        transitionDuration = '';
      }
      if (property === 'transition-property') transitionProperty = style.getPropertyValue(property);
      if (property === 'transition-duration') transitionDuration = style.getPropertyValue(property);
    }
  }
  const shorthand = transition.split(/,(?![^()]*\))/u).map((part) => part.trim());
  const properties = transitionProperty
    ? transitionProperty.split(',').map((part) => part.trim())
    : shorthand.map((part) => {
        const property = part
          .split(/\s+/u)
          .map((token) => token.toLowerCase())
          .find((token) => ['all', 'none', 'top', 'height'].includes(token));
        return property ?? 'all';
      });
  const durations = transitionDuration
    ? transitionDuration.split(',').map((part) => Number.parseFloat(part))
    : shorthand.map((part) => {
        const duration = part.match(/(?:^|\s)([\d.]+)(ms|s)(?:\s|$)/u);
        return duration ? Number.parseFloat(duration[1] ?? '0') : 0;
      });
  properties.forEach((property, index) => {
    if (['all', 'top', 'height'].includes(property)) {
      expect(durations[index % durations.length], `${node.className}: ${property}`).toBe(0);
    }
  });
}
