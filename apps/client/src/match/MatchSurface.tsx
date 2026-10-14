import { SandboxSurface } from '../dev/DevSandboxPage.tsx';

export function MatchSurface({
  debug,
  showOnboarding,
}: {
  debug: boolean;
  showOnboarding: boolean;
}): React.JSX.Element {
  return <SandboxSurface debug={debug} showOnboarding={showOnboarding} />;
}
