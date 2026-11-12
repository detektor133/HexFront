import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DevMapPage } from './dev/DevMapPage.tsx';
import { DevSandboxPage } from './dev/DevSandboxPage.tsx';
import { DevUnitsPage } from './dev/DevUnitsPage.tsx';
import { messages, t } from './i18n/dict.ts';
import { applyDocumentLang } from './i18n/document-lang.ts';
import { MatchPage } from './match/MatchPage.tsx';
import { lobbyFromUrl } from './menu/LobbyPanel.tsx';
import { MainMenu } from './menu/MainMenu.tsx';
import { useLocation } from './nav.ts';
import { isDevPath, isMatchPath } from './routes.ts';
import { applyTheme, currentTheme } from './theme/theme.ts';
import './theme/tokens.css';
import './theme/themes.css';
import './theme/fonts.css';
import './theme/global.css';

export function App(): React.JSX.Element {
  const { pathname: path, search } = useLocation();
  if (path === '/' || path === '/menu') return <MainMenu />;
  // Ключ по строке запроса: переход к другому матчу собирает экран заново.
  if (isMatchPath(path)) return <MatchPage key={search} />;
  // Ссылка-приглашение /online?room=КОД открывает меню сразу с лобби.
  if (path === '/online')
    return <MainMenu key={search} initialLobby={lobbyFromUrl(`/online${search}`)} />;
  if (import.meta.env.PROD && isDevPath(path)) return <p>{messages.ru['dev.notFound']}</p>;
  if (path === '/dev/map') return <DevMapPage />;
  if (path === '/dev/units') return <DevUnitsPage />;
  // /dev/economy — прежний адрес песочницы (этап 02), оставлен для старых ссылок.
  if (isDevPath(path) && (path === '/dev/sandbox' || path === '/dev/economy' || path === '/dev/ui'))
    return <DevSandboxPage />;
  return <p>{t('dev.notFound')}</p>;
}

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');
applyDocumentLang(document.documentElement);
applyTheme(currentTheme());
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
