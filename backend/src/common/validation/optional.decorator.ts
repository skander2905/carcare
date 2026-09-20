import { ValidateIf } from 'class-validator';

/**
 * Skips validation only when the property is **absent**.
 *
 * `@IsOptional()` treats `null` as absent too, so `{ "displayName": null }`
 * passes every validator on the field and arrives at the repository as an
 * explicit null. The columns behind these DTOs are non-nullable, so that turns
 * a malformed request into a 500 instead of the 400 it should be.
 *
 * This is the right default for a PATCH: omitting a field means "leave it
 * alone", while sending null means "set it to nothing" — which for a required
 * column is simply invalid, and should say so.
 */
export const IsOptionalProperty = () => ValidateIf((_object, value) => value !== undefined);
