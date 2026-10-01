// A long move crosses at least one whole row or column. Adjacent diagonals stay valid.
const types = Array.from({ length: 10 }, () => Array(10).fill(null));
for (let from = 1; from <= 9; from++) {
  for (let to = 1; to <= 9; to++) {
    const rows = Math.abs(Math.floor((from - 1) / 3) - Math.floor((to - 1) / 3));
    const columns = Math.abs(((from - 1) % 3) - ((to - 1) % 3));
    if (rows > 1 || columns > 1) types[from][to] = rows && columns ? 'diagonal' : 'straight';
  }
}

export function connectionType(from, to) { return types[from][to]; }

export function resolveConnectionRules({ adjacentOnly = false, excludeLongDiagonal = adjacentOnly, excludeLongStraight = adjacentOnly } = {}) {
  for (const value of [adjacentOnly, excludeLongDiagonal, excludeLongStraight]) {
    if (typeof value !== 'boolean') throw new TypeError('跨格连线规则必须是布尔值');
  }
  // Explicit fields override the legacy combined option independently.
  return { excludeLongDiagonal, excludeLongStraight };
}

export function connectionAllowed(from, to, rules) {
  const type = connectionType(from, to);
  return type === 'diagonal' ? !rules.excludeLongDiagonal : type === 'straight' ? !rules.excludeLongStraight : true;
}
