import { describe, expect, it } from "vitest";
import { formatDateRange, formatMonthYear, isUnrecognizedDate, parseFlexibleDate, toMMYYYY } from "./format-date";

describe("parseFlexibleDate", () => {
  it("parses the formats the autofill accepts", () => {
    expect(parseFlexibleDate("2021-06")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("2021-06-15")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("06/2021")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("6/2021")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("June 2021")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("Sept. 2019")).toEqual({ year: 2019, month: 9 });
    expect(parseFlexibleDate("2021")).toEqual({ year: 2021 });
  });

  it("expands two-digit years", () => {
    expect(parseFlexibleDate("06/21")).toEqual({ year: 2021, month: 6 });
    expect(parseFlexibleDate("06/95")).toEqual({ year: 1995, month: 6 });
  });

  it("returns null for present/unparseable", () => {
    expect(parseFlexibleDate("Present")).toBeNull();
    expect(parseFlexibleDate("Current")).toBeNull();
    expect(parseFlexibleDate("sometime last year")).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });
});

describe("formatMonthYear / formatDateRange", () => {
  it("renders a uniform Mon YYYY", () => {
    expect(formatMonthYear("2022-08")).toBe("Aug 2022");
    expect(formatMonthYear("8/2022")).toBe("Aug 2022");
    expect(formatMonthYear("2022")).toBe("2022");
    expect(formatMonthYear("Present")).toBe("Present");
  });

  it("leaves unparseable text unchanged rather than mangling it", () => {
    expect(formatMonthYear("Summer 2022")).toBe("Summer 2022");
  });

  it("builds an en-dash range and drops empty sides", () => {
    expect(formatDateRange("2021-06", "Present")).toBe("Jun 2021 – Present");
    expect(formatDateRange("2021-06", "")).toBe("Jun 2021");
    expect(formatDateRange("", "")).toBe("");
  });
});

describe("toMMYYYY", () => {
  it("normalizes any parseable date to MM/YYYY", () => {
    expect(toMMYYYY("2019-01")).toBe("01/2019");
    expect(toMMYYYY("2025-05")).toBe("05/2025");
    expect(toMMYYYY("Jan 2018")).toBe("01/2018");
    expect(toMMYYYY("8/2022")).toBe("08/2022");
    expect(toMMYYYY("2021")).toBe("2021");
    expect(toMMYYYY("Present")).toBe("Present");
    expect(toMMYYYY("")).toBe("");
  });

  it("leaves already-MM/YYYY and unparseable text unchanged", () => {
    expect(toMMYYYY("05/2024")).toBe("05/2024");
    expect(toMMYYYY("Summer 2022")).toBe("Summer 2022");
  });
});

describe("isUnrecognizedDate", () => {
  it("flags only non-empty unparseable dates", () => {
    expect(isUnrecognizedDate("")).toBe(false);
    expect(isUnrecognizedDate("Present")).toBe(false);
    expect(isUnrecognizedDate("08/2022")).toBe(false);
    expect(isUnrecognizedDate("last summer")).toBe(true);
  });
});
