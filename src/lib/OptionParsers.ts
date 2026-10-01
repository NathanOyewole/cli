import { InvalidArgumentError } from "commander";

export class OptionParsers {
  public static positiveInt(value: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidArgumentError("Must be a positive integer.");
    }
    return n;
  }

  public static nonNegativeInt(value: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new InvalidArgumentError("Must be a non-negative integer.");
    }
    return n;
  }

  public static number(value: string): number {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) {
      throw new InvalidArgumentError("Must be a number.");
    }
    return n;
  }

  public static oneOf(values: readonly string[]): (value: string) => string {
    return (value) => {
      if (!values.includes(value)) {
        throw new InvalidArgumentError(`Must be one of: ${values.join(", ")}.`);
      }
      return value;
    };
  }

  public static list(value: string): string[] {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  public static timestamp(value: string): string {
    const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value);
    if (isNaN(ms)) {
      throw new InvalidArgumentError(`Invalid date: ${value}`);
    }
    return new Date(ms).toISOString();
  }
}
