/**
 * Domain icons lucide doesn't have, drawn on lucide's 24×24 grid with the same stroke style so
 * they sit well next to its icons.
 */
interface IconProps {
  readonly size?: number;
  readonly strokeWidth?: number;
}

function Svg({ size = 16, strokeWidth = 2, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** An ANSI AND gate (gate style). */
export function GateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 5h6a7 7 0 0 1 0 14H6z" />
      <path d="M2 9h4M2 15h4M19 12h3" />
    </Svg>
  );
}

/** A DIP chip outline with pins (parts). */
export function ChipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 3h4a1 1 0 0 0 2 0h4v18H7z" />
      <path d="M4 7h3M4 12h3M4 17h3M17 7h3M17 12h3M17 17h3" />
    </Svg>
  );
}
