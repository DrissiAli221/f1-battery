/*
 * Driver quotes, verbatim, from docs/research-2026-10-17-discourse.md (each marked F there:
 * fetched and read). The source line says where it was read; nothing here is paraphrased.
 * Name and team are fallbacks for when the drivers endpoint is unavailable; the headshot and
 * the team colour come from the API at runtime (DECISIONS.md D24).
 */
export interface Quote {
  code: string;
  name: string;
  team: string;
  text: string;
  source: string;
}

export const QUOTES: Quote[] = [
  {
    code: "NOR",
    name: "Lando Norris",
    team: "McLaren",
    text: "I literally had 5% of my battery coming out the last corner. There was no point of trying to defend.",
    source: "via pitdebrief, 2026 season",
  },
  {
    code: "ALO",
    name: "Fernando Alonso",
    team: "Aston Martin",
    text: "You just press one button and you overtake if you have a better power unit than the car in front.",
    source: "Silverstone, 2026",
  },
  {
    code: "OCO",
    name: "Esteban Ocon",
    team: "Haas F1 Team",
    text: "Boost usage has been a nightmare, if you use it, you actually go backwards.",
    source: "via crash.net, 2026 season",
  },
];
