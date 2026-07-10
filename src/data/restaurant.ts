/**
 * Restaurant info for New Mandarin Canton II.
 */

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface DailyHours {
  open: string;
  close: string;
  closed?: boolean;
}

export interface RestaurantInfo {
  name: string;
  /** Verified Chinese name from the restaurant's sign — null until confirmed. */
  chineseName: string | null;
  tagline: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  phone: string;
  hours: Record<DayOfWeek, DailyHours>;
}

export const restaurant: RestaurantInfo = {
  name: "New Mandarin Canton II",
  chineseName: "富源", // verified — the name on the restaurant's seal
  tagline: "Traditional Cantonese & Mandarin cuisine in Chula Vista, CA",
  address: {
    street: "543 Telegraph Canyon Rd",
    city: "Chula Vista",
    state: "CA",
    zip: "91910",
  },
  phone: "(619) 656-6888",
  hours: {
    monday: { open: "11:00 AM", close: "9:00 PM" },
    tuesday: { open: "11:00 AM", close: "9:00 PM" },
    wednesday: { open: "11:00 AM", close: "9:00 PM" },
    thursday: { open: "11:00 AM", close: "9:00 PM" },
    friday: { open: "11:00 AM", close: "9:00 PM" },
    saturday: { open: "11:00 AM", close: "9:30 PM" },
    sunday: { open: "11:00 AM", close: "8:30 PM" },
  },
};
