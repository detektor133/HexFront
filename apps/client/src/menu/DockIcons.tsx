// Значки дока с собственной анимацией: мечи сходятся и высекают искру, глобус вращается, робот
// моргает. Анимации — CSS (menu-dock.module.css), в режиме «меньше движения» они выключены.
import styles from './menu-dock.module.css';

/** Меч остриём вверх; в SVG поворачивается вокруг центра значка. */
function Sword(props: { readonly className: string | undefined }): React.JSX.Element {
  return (
    <g className={props.className}>
      <path d="M24 3 L27.4 8 V29 H20.6 V8 Z" fill="currentColor" />
      <rect x="15.5" y="29" width="17" height="3.4" rx="1.7" fill="currentColor" />
      <rect x="22.4" y="32.4" width="3.2" height="9" rx="1.2" fill="currentColor" />
      <circle cx="24" cy="44" r="2.4" fill="currentColor" />
    </g>
  );
}

/** Скрещённые мечи: расходятся, бьют друг о друга и выпускают искру. */
export function SwordsIcon(props: { readonly size?: number }): React.JSX.Element {
  const size = props.size ?? 32;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={styles.swords}
    >
      <Sword className={styles.swordA} />
      <Sword className={styles.swordB} />
      <path
        className={styles.spark}
        d="M24 11 L25.8 21 L36 24 L25.8 27 L24 37 L22.2 27 L12 24 L22.2 21 Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Глобус: меридианы сжимаются и растягиваются, как при вращении, по орбите бегут огоньки игроков. */
export function GlobeIcon(props: { readonly size?: number }): React.JSX.Element {
  const size = props.size ?? 28;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={styles.globe}>
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <circle cx="24" cy="24" r="17" />
        <path d="M8 18 H40 M8 30 H40" strokeWidth="2" />
        <ellipse className={styles.meridianA} cx="24" cy="24" rx="8" ry="17" strokeWidth="2.2" />
        <ellipse className={styles.meridianB} cx="24" cy="24" rx="8" ry="17" strokeWidth="2.2" />
      </g>
      <circle className={styles.blipA} cx="33" cy="15" r="2.6" fill="currentColor" />
      <circle className={styles.blipB} cx="16" cy="31" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** Робот: моргает, антенна покачивается, голова наклоняется при наведении. */
export function RobotIcon(props: { readonly size?: number }): React.JSX.Element {
  const size = props.size ?? 28;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={styles.robot}>
      <g className={styles.robotHead}>
        <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <rect x="9" y="17" width="30" height="23" rx="7" />
          <path d="M3.5 26 V32 M44.5 26 V32" strokeWidth="3.2" />
          <path d="M18 34 H30" strokeWidth="2.2" />
          <path className={styles.antenna} d="M24 17 V10" />
        </g>
        <circle className={styles.antennaBall} cx="24" cy="7" r="3" fill="currentColor" />
        <circle className={styles.eye} cx="17.5" cy="26" r="3" fill="currentColor" />
        <circle className={styles.eye} cx="30.5" cy="26" r="3" fill="currentColor" />
      </g>
    </svg>
  );
}
