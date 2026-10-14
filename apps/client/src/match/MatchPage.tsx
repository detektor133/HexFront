import { MatchSurface } from '../dev/DevSandboxPage.tsx';

export function MatchPage(): React.JSX.Element {
  const debug = new URLSearchParams(window.location.search).get('debug') === '1';
  return <MatchSurface debug={debug} showOnboarding />;
}
