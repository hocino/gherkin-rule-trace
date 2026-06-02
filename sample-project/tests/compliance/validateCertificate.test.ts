import { validateCertificate } from "../../src/domain/compliance/validateCertificate";

describe("#010 A vigilance certificate must be valid", () => {
  it("rejects expired certificates", () => {
    expect(validateCertificate(new Date("2020-01-01"))).toBe(false);
  });
});
