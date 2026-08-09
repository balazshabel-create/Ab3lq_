/**
 * Egyszerű ellenőrzőösszeg a mentéshez (FNV-1a + só).
 *
 * FONTOS, MIT NEM: ez **nem titkosítás és nem csalásvédelem**. Egy rootolt
 * készüléken bárki átírhatja a mentést, és mivel a játék offline, ezt
 * kliensoldalon megakadályozni elvileg lehetetlen. Két dolgot ad:
 *
 *  1. Kiszűri a **sérült / félig kiírt** mentést (áramszünet, kill -9),
 *     és ilyenkor a biztonsági másolatra tudunk visszaállni.
 *  2. Megfogja a naiv, kézi JSON-szerkesztést.
 *
 * Mivel nincs multiplayer és nincs ranglista, a csalás csak a csaló saját
 * élményét rontja – ezért szándékosan nem építünk ide agresszív, hamis
 * pozitívokat termelő védelmet, ami a becsületes játékosok mentését dobná el.
 */

export function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeChecksum(payload: string, salt: string): string {
  return fnv1a(`${salt}:${payload}:${salt}`).toString(36);
}

export function verifyChecksum(payload: string, salt: string, expected: string): boolean {
  return computeChecksum(payload, salt) === expected;
}
