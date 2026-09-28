// Money is never a floating-point number: 0.1 + 0.2 !== 0.3 in JavaScript.
// Amounts travel as decimal strings ("123.45", the format Duffel uses) and all maths
// happens in integer minor units (cents, fils), then goes back to a string.

export function toMinor(amount: string): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid money amount: ${amount}`);
  const [, neg, whole, frac = ''] = m;
  const minor = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -minor : minor;
}

export function fromMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Percentage change from `base` to `value`, rounded to 2 decimals. */
export function pctChange(base: number, value: number): number {
  return base === 0 ? 0 : Math.round(((value - base) / base) * 10_000) / 100;
}
