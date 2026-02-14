/**
 * Human-friendly time expression parser for CLI --since/--before flags.
 *
 * Supported patterns (in priority order):
 *   Relative duration: 5s, 10m, 2h, 3d, 1w
 *   Named:            now, today, yesterday
 *   Day of week:      monday, tue, fri (full or 3-letter abbreviation)
 *   Time of day 12h:  10am, 2:30pm
 *   Time of day 24h:  14:30, 9:00
 *   ISO date:         2024-01-01
 *   ISO datetime:     2024-01-01T10:00, 2024-01-01 10:00
 */

const RELATIVE_DURATION_RE = /^(\d+)(s|m|h|d|w)$/;
const TIME_12H_RE = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i;
const TIME_24H_RE = /^(\d{1,2}):(\d{2})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2})?$/;

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Set a Date to midnight (00:00:00.000) in local time.
 */
function toMidnight(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Parse a human-friendly time expression into an epoch millisecond timestamp.
 *
 * @param input - The time expression string
 * @param now - Override for current time (for testing). Defaults to Date.now().
 * @returns Epoch milliseconds
 * @throws Error on invalid input with a message listing supported formats
 */
export function parseTime(input: string, now?: number): number {
  const trimmed = input.trim().toLowerCase();
  const currentMs = now ?? Date.now();

  // Named constants
  if (trimmed === "now") {
    return currentMs;
  }

  if (trimmed === "today") {
    return toMidnight(new Date(currentMs)).getTime();
  }

  if (trimmed === "yesterday") {
    const d = new Date(currentMs);
    d.setDate(d.getDate() - 1);
    return toMidnight(d).getTime();
  }

  // Relative duration: 5s, 10m, 2h, 3d, 1w
  const relMatch = RELATIVE_DURATION_RE.exec(trimmed);
  if (relMatch) {
    const amountStr = relMatch[1] ?? "0";
    const unit = relMatch[2] ?? "s";
    const amount = parseInt(amountStr, 10);
    const multiplier = DURATION_UNITS[unit];
    if (multiplier === undefined) {
      throw new Error(`Unknown duration unit: ${unit}`);
    }
    const result = currentMs - amount * multiplier;
    if (result < 0) {
      throw new Error(`Duration "${input}" is too large (resolves to before Unix epoch)`);
    }
    return result;
  }

  // Day of week: monday, tue, fri etc
  const dayIndex = DAY_NAMES[trimmed];
  if (dayIndex !== undefined) {
    const d = new Date(currentMs);
    const currentDay = d.getDay();
    // How many days ago was this weekday? If today is the same day, go back 7.
    let daysBack = currentDay - dayIndex;
    if (daysBack <= 0) {
      daysBack += 7;
    }
    d.setDate(d.getDate() - daysBack);
    return toMidnight(d).getTime();
  }

  // Time of day 12h: 10am, 2:30pm
  const time12Match = TIME_12H_RE.exec(trimmed);
  if (time12Match) {
    let hours = parseInt(time12Match[1] ?? "0", 10);
    const minutes = time12Match[2] ? parseInt(time12Match[2], 10) : 0;
    const period = (time12Match[3] ?? "am").toLowerCase();

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid 12-hour time: ${input}`);
    }

    if (period === "am" && hours === 12) {
      hours = 0;
    } else if (period === "pm" && hours !== 12) {
      hours += 12;
    }

    const d = new Date(currentMs);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
  }

  // Time of day 24h: 14:30, 9:00
  const time24Match = TIME_24H_RE.exec(trimmed);
  if (time24Match) {
    const hours = parseInt(time24Match[1] ?? "0", 10);
    const minutes = parseInt(time24Match[2] ?? "0", 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid 24-hour time: ${input}`);
    }

    const d = new Date(currentMs);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
  }

  // ISO datetime: 2024-01-01T10:00 or 2024-01-01 10:00
  if (ISO_DATETIME_RE.test(trimmed)) {
    // Normalise to uppercase T and space to T for Date constructor
    const normalised = trimmed.replace(/[t ]/, "T");
    const ts = new Date(normalised).getTime();
    if (isNaN(ts)) {
      throw new Error(`Invalid datetime: ${input}`);
    }
    return ts;
  }

  // ISO date: 2024-01-01
  if (ISO_DATE_RE.test(trimmed)) {
    // Parse as local date by appending T00:00:00 to avoid UTC interpretation
    const ts = new Date(trimmed + "T00:00:00").getTime();
    if (isNaN(ts)) {
      throw new Error(`Invalid date: ${input}`);
    }
    return ts;
  }

  throw new Error(
    `Unrecognised time expression: "${input}"\n` +
      "Supported formats:\n" +
      "  Relative:  5s, 10m, 2h, 3d, 1w\n" +
      "  Named:     now, today, yesterday\n" +
      "  Weekday:   monday, tue, fri\n" +
      "  Time 12h:  10am, 2:30pm\n" +
      "  Time 24h:  14:30, 9:00\n" +
      "  ISO date:  2024-01-01\n" +
      "  ISO dt:    2024-01-01T10:00"
  );
}
