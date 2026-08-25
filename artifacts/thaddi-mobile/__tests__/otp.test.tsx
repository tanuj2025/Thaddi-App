import { isValidOtp, normalizeOtp } from "@/lib/otp";

describe("OTP input normalization", () => {
  test("keeps numeric input and discards pasted separators or letters", () => {
    expect(normalizeOtp("12-34 5x6")).toBe("123456");
  });

  test("converts Arabic and Persian digits for the server OTP contract", () => {
    expect(normalizeOtp("١٢٣٤٥٦")).toBe("123456");
    expect(normalizeOtp("۱۲۳۴۵۶")).toBe("123456");
  });

  test("caps a pasted code at the API maximum", () => {
    expect(normalizeOtp("1234567890")).toBe("12345678");
  });

  test("accepts only numeric OTPs within the API length range", () => {
    expect(isValidOtp("1234")).toBe(true);
    expect(isValidOtp("12345678")).toBe(true);
    expect(isValidOtp("123")).toBe(false);
    expect(isValidOtp("123456789")).toBe(false);
    expect(isValidOtp("1234a")).toBe(false);
  });
});