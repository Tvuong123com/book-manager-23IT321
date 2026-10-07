export function createRules(studentId) {
  if (typeof studentId !== 'string' || !/\d{3}$/.test(studentId)) {
    throw new Error('STUDENT_ID phải kết thúc bằng ba chữ số');
  }

  const prefix = studentId.slice(-3);
  const vatRate = Number(studentId.at(-1)) + 4;
  const codePattern = new RegExp(`^${prefix}[A-Za-z0-9_-]{1,29}$`);

  return {
    prefix,
    vatRate,
    isValidCode(code) {
      return typeof code === 'string' && codePattern.test(code);
    },
    priceAfterVat(basePrice) {
      if (
        !Number.isSafeInteger(basePrice) ||
        basePrice < 0 ||
        basePrice > 1_000_000_000
      ) {
        throw new RangeError('Giá phải là số nguyên từ 0 đến 1 tỷ VND');
      }

      return Math.round((basePrice * (100 + vatRate)) / 100);
    }
  };
}
