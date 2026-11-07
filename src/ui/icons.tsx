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

/** A wire with a corner between two connection dots (the Wire tool). */
/** A bus line: a heavy line with entries leaving it. */
export function BusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 4v16" strokeWidth="3.5" />
      <path d="M6 8l3 3h10M6 14l3 3h10" />
    </Svg>
  );
}

export function WireIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 18h7V6h7" />
      <circle cx="4" cy="18" r="1.6" />
      <circle cx="20" cy="6" r="1.6" />
    </Svg>
  );
}
