export const ISO_DATE_FORMAT = "YYYY-MM-DD";
export const ISO_DATETIME_FORMAT = "YYYY-MM-DDTHH:mm:ss.SSSZ";
export const IST_TIMEZONE = "Asia/Kolkata";

export function toISODateString(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d.toISOString().slice(0, 10);
}

export function toISODateTimeString(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d.toISOString();
}

export function toISTDateString(date: Date | string | number): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return d.toLocaleString("en-IN", { 
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).split("/").reverse().join("-");
}

export function parseDate(dateString: string): Date | null {
  const parsed = Date.parse(dateString);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

export function isValidDateString(dateString: string): boolean {
  return Date.parse(dateString) > 0;
}

export function getCurrentISTDate(): string {
  return toISTDateString(new Date());
}

export function getCurrentISODate(): string {
  return toISODateString(new Date());
}

export function getDaysBetween(startDate: string | Date, endDate: string | Date): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}
