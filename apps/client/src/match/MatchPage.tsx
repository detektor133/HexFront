import { MatchSurface } from './MatchSurface.tsx';
import { appSearch } from '../nav.ts';
import { CHAPTERS, type ChapterId } from '../tutorial/script.ts';

export function MatchPage(): React.JSX.Element {
  const params = new URLSearchParams(appSearch());
  const debug = params.get('debug') === '1';
  const asked = params.get('tutorial');
  const tutorial = CHAPTERS.find((chapter): chapter is ChapterId => chapter === asked) ?? null;
  return <MatchSurface debug={debug} tutorial={tutorial} />;
}
