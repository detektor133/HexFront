import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DevMapPage } from './dev/DevMapPage.tsx';
import { DevSandboxPage } from './dev/DevSandboxPage.tsx';
import { DevUnitsPage } from './dev/DevUnitsPage.tsx';
import { t } from './i18n/dict.ts';
import { MainMenu } from './menu/MainMenu.tsx';
import { isDevPath } from './routes.ts';
import './theme/tokens.css';
import './theme/fonts.css';
import './theme/global.css';

function App(): React.JSX.Element {
  const path = window.location.pathname;
  if (path === '/' || path === '/menu') return <MainMenu />;
  if (path === '/dev/map') return <DevMapPage />;
  if (path === '/dev/units') return <DevUnitsPage />;
  // /dev/economy — прежний адрес песочницы (этап 02), оставлен для старых ссылок.
  if (isDevPath(path) && (path === '/dev/sandbox' || path === '/dev/economy' || path === '/dev/ui'))
    return <DevSandboxPage />;
  return <p>{t('dev.notFound')}</p>;
}

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
