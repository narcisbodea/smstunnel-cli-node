// The GSM 03.38 default alphabet (one unit each) and its extension table (two units each: escape + char).
const GSM7_BASIC = new Set(
  Array.from(
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
      '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
  ),
);
const GSM7_EXTENSION = new Set(Array.from('\f^{}\\[~]|€'));

export interface SmsParts {
  /** GSM-7 for plain Latin text; UCS-2 as soon as one character is outside it (ș, ț, emoji…). */
  encoding: 'GSM-7' | 'UCS-2';
  /** Characters as SMSTunnel counts them for its 1600 limit (an emoji counts once). */
  characters: number;
  /** How many SMS parts the phone will most likely split the text into. */
  parts: number;
}

/** An estimate of the parts a text takes: 160 / 153 per part in GSM-7, 70 / 67 in UCS-2. */
export function smsParts(text: string): SmsParts {
  const chars = Array.from(text);
  const characters = chars.length;
  if (characters === 0) return { encoding: 'GSM-7', characters: 0, parts: 0 };

  let units = 0;
  let gsm = true;
  for (const ch of chars) {
    if (GSM7_BASIC.has(ch)) units += 1;
    else if (GSM7_EXTENSION.has(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    return { encoding: 'GSM-7', characters, parts: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const codeUnits = text.length; // UTF-16: an emoji takes two
  return { encoding: 'UCS-2', characters, parts: codeUnits <= 70 ? 1 : Math.ceil(codeUnits / 67) };
}

/** Characters as SMSTunnel's length check counts them (code points). */
export function characterCount(text: string): number {
  return Array.from(text).length;
}
