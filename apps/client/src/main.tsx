import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DevMapPage } from './dev/DevMapPage.tsx';
import { DevSandboxPage } from './dev/DevSandboxPage.tsx';
import { t } from './i18n/dict.ts';
import './theme/tokens.css';
import './theme/fonts.css';
import './theme/global.css';

function App(): React.JSX.Element {
  if (window.location.pathname === '/dev/map') return <DevMapPage />;
  // /dev/economy — прежний адрес песочницы (этап 02), оставлен для старых ссылок.
  const path = window.location.pathname;
  if (path === '/dev/sandbox' || path === '/dev/economy') return <DevSandboxPage />;
  return <p>{t('dev.notFound')}</p>;
}

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
