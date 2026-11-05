import { MatchSurface } from './MatchSurface.tsx';
import { CHAPTERS, type ChapterId } from '../tutorial/script.ts';

export function MatchPage(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get('debug') === '1';
  const asked = params.get('tutorial');
  const tutorial = CHAPTERS.find((chapter): chapter is ChapterId => chapter === asked) ?? null;
  return <MatchSurface debug={debug} tutorial={tutorial} />;
}
