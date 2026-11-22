// The logo's closed, happy eyes (^^). Used as the listening indicator and on the
// blank title slide. Colour comes from `currentColor`.
export function Eyes({ size = 24, className = '' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size * 0.4}
      viewBox="0 0 50 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 15 C9 5 17 5 22 15" />
      <path d="M28 15 C33 5 41 5 46 15" />
    </svg>
  )
}
