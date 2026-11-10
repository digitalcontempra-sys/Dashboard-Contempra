import type { AccessLevel } from "./types";

/**
 * Contempra staff from the sheet's Contributors tab, as approved by the owner on 2026-11-09.
 * Usernames are the first name, plus the last initial where a first name repeats.
 * Sebastian is not here: he already has his own admin account.
 */
export type RosterPerson = { username: string; fullName: string; accessLevel: AccessLevel; roles: string[] };

const staff = (username: string, fullName: string, ...roles: string[]): RosterPerson => ({ username, fullName, accessLevel: "staff", roles });

export const STAFF_ROSTER: RosterPerson[] = [
  { username: "jeff.b", fullName: "Jeff Baumer", accessLevel: "admin", roles: [] },
  { username: "meinrad", fullName: "Meinrad", accessLevel: "admin", roles: [] },
  { username: "diane", fullName: "Diane", accessLevel: "admin", roles: [] },
  { username: "danni", fullName: "Danni", accessLevel: "manager", roles: [] },
  { username: "ali", fullName: "Ali", accessLevel: "manager", roles: [] },
  { username: "kristy", fullName: "Kristy", accessLevel: "manager", roles: [] },
  { username: "jackie", fullName: "Jackie", accessLevel: "manager", roles: [] },
  { username: "justin", fullName: "Justin", accessLevel: "manager", roles: ["designer"] },
  staff("ira", "Ira", "designer"),
  staff("nataly", "Nataly", "designer"),
  staff("george.g", "George Gonzales", "printer_fb"),
  staff("matt", "Matt", "printer_fb"),
  staff("kharash", "Kharash Ibrahim", "laminate_roll", "finishing", "installer"),
  staff("jeff.w", "Jeff Whitaker", "laminate_roll", "finishing", "installer"),
  staff("gary", "Gary", "installer"),
  staff("dennis", "Dennis", "installer"),
  staff("george.i", "George Inch", "installer"),
  staff("john", "John", "liquid_lam"),
  staff("nick", "Nick", "finishing", "installer"),
  staff("tristan", "Tristan", "finishing"),
  staff("larry", "Larry", "finishing"),
  staff("robert.m", "Robert Merkel", "finishing"),
  staff("lee", "Lee Fonseca", "colex", "finishing"),
  staff("erin", "Erin", "printer_roll"),
  staff("rob.p", "Rob Porter", "printer_fb", "printer_roll"),
];
