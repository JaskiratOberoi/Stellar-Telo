/**
 * Business limits shared by client components and server code.
 * Keep these here (not in a 'use server' module — those may only export
 * async functions) so the form and the enforcement paths read one value.
 */

/** A mobile number may be used by at most this many Telo-registered patients.
 *  Enforced live in the New Order form, re-checked in registerOrder, and
 *  guarded authoritatively inside dbo.usp_telo_create_order. */
export const MAX_PATIENTS_PER_MOBILE = 4;
