export function normalizeBarcode(value: string): string | null {
  const digits = value.trim().replace(/[\s-]/g, '');
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1)) ? digits.padStart(14, '0') : null;
}
