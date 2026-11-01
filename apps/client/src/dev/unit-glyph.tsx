import type { UnitType } from '@hexfront/sim';

/** Глиф рода войск 14×14 для карточек и фишек интерфейса. */
export function UnitGlyph(props: {
  type: UnitType;
  className: string | undefined;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={props.className}
      data-unit-type={props.type}
      viewBox="0 0 14 14"
    >
      {props.type === 'infantry' ? (
        <polyline points="2,10 7,5 12,10" />
      ) : props.type === 'armor' ? (
        <polygon points="7,2 12,7 7,12 2,7" />
      ) : (
        <>
          <path d="M2 10 A5 5 0 0 1 12 10" />
          <circle cx="7" cy="10" r="1.75" />
        </>
      )}
    </svg>
  );
}
