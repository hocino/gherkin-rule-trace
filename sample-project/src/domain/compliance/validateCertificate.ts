// #010 A vigilance certificate must be valid
export function validateCertificate(expiresAt: Date): boolean {
  return expiresAt.getTime() > Date.now();
}
