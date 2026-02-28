// /clear is handled client-side (resets CLI state without a server round-trip).
// This handler exists for protocol completeness and returns an empty string.
export function clearHandler(): string {
  return '';
}
