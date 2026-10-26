import { useLayoutEffect, useRef } from 'react';

export function GoldIcon(props: {
  className?: string;
  label?: string;
  strokeWidth?: number;
  strokeLinejoin?: 'round' | 'inherit';
  includePathContours?: boolean;
}): React.JSX.Element {
  const iconRef = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (props.label) iconRef.current?.setAttribute('title', props.label);
    else iconRef.current?.removeAttribute('title');
  }, [props.label]);
  return (
    <svg
      ref={iconRef}
      viewBox="0 0 14 14"
      {...(props.className ? { className: props.className } : {})}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 1.5}
      strokeLinecap="round"
      strokeLinejoin={props.strokeLinejoin}
    >
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="8" cy="7" r="4.5" />
      {props.includePathContours && <path d="M0 0M0 0" aria-hidden="true" />}
      {props.includePathContours && <path d="M0 0M0 0" aria-hidden="true" />}
    </svg>
  );
}
