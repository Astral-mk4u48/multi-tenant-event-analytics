/**
 * Deterministic dot-segment pattern matching for webhook event subscriptions.
 * Avoids user-supplied regular expressions to eliminate ReDoS vulnerabilities.
 *
 * Supported patterns:
 * - '*' matches all events
 * - 'payment.*' matches any single-segment suffix after 'payment.' (e.g. 'payment.succeeded')
 * - 'payment.**' matches any multi-segment suffix after 'payment.'
 * - Exact matches (e.g. 'user.signup')
 */
export function matchesEventPattern(pattern: string, eventName: string): boolean {
  if (pattern === "*" || pattern === "**") {
    return true;
  }

  if (pattern === eventName) {
    return true;
  }

  const patternParts = pattern.split(".");
  const eventParts = eventName.split(".");

  let pIdx = 0;
  let eIdx = 0;

  while (pIdx < patternParts.length && eIdx < eventParts.length) {
    const p = patternParts[pIdx];

    if (p === "**") {
      // If ** is at the end, matches everything remaining
      if (pIdx === patternParts.length - 1) {
        return true;
      }
      // Otherwise match forward
      pIdx++;
      const nextPattern = patternParts[pIdx];
      while (eIdx < eventParts.length && eventParts[eIdx] !== nextPattern) {
        eIdx++;
      }
      continue;
    }

    if (p === "*" || p === eventParts[eIdx]) {
      pIdx++;
      eIdx++;
    } else {
      return false;
    }
  }

  return pIdx === patternParts.length && eIdx === eventParts.length;
}

export function matchesAnyPattern(patterns: string[], eventName: string): boolean {
  return patterns.some((p) => matchesEventPattern(p, eventName));
}
