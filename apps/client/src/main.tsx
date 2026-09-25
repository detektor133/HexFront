import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DevEconomyPage } from './dev/DevEconomyPage.tsx';
import { DevMapPage } from './dev/DevMapPage.tsx';
import { t } from './i18n/dict.ts';
import './theme/tokens.css';
import './theme/fonts.css';
import './theme/global.css';

function App(): React.JSX.Element {
  if (window.location.pathname === '/dev/map') return <DevMapPage />;
  if (window.location.pathname === '/dev/economy') return <DevEconomyPage />;
  return <p>{t('dev.notFound')}</p>;
}

const root = document.getElementById('root');
if (!root) throw new Error('нет элемента #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
