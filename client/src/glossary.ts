/**
 * Plain-language explanations of the console's terms, all in one place so they can be reviewed
 * and later translated together. Wording follows the checker (server/checker/checker.ts), which
 * is the source of truth for cost and feasibility.
 */
export interface GlossaryEntry {
  title: string;
  text: string;
}

export const GLOSSARY = {
  schedule: {
    title: "Schedule",
    text: "The plan for every 15 minutes: fan mass flow, recirculation, heating and cooling. Baseline follows fixed rules and ignores the price. Optimized is calculated to cost less while staying within the limits.",
  },
  baseline: {
    title: "Baseline",
    text: "The schedule from fixed rules, which ignores the electricity price. It is what the day would cost without optimization.",
  },
  optimized: {
    title: "Optimized",
    text: "The schedule calculated to cost less, for example by heating, cooling or ventilating when electricity is cheap, because the building stores heat for hours.",
  },
  spotPrice: {
    title: "Spot price",
    text: "The day-ahead market price of electricity. It changes during the day, and all fan, heating and cooling energy is bought at it.",
  },
  massFlow: {
    title: "Mass flow",
    text: "How much air the fan moves into the hall, in kilograms per second. More air means more ventilation, and a higher fan power cost.",
  },
  recirculation: {
    title: "Recirculation",
    text: "The share of supply air taken back from the hall instead of from outdoors. 0,60 means 60 % reused and 40 % fresh. More reuse saves heating or cooling, but less fresh air lets CO₂ rise.",
  },
  thermalPower: {
    title: "Heating and cooling",
    text: "Heat added by the boiler or removed by the chiller, in kW. This is the effect on the air, not the electricity used: see boiler efficiency and chiller COP in the cost breakdown.",
  },
  temperature: {
    title: "Indoor temperature",
    text: "The solid line is what sensors measured. The dashed line is simulated from the shown schedule. The green area is the allowed band: the range the hall must stay in, narrower during shifts than outside them.",
  },
  co2: {
    title: "Indoor CO₂",
    text: "How much CO₂ is in the hall air, which rises with people and falls with fresh air. The solid line is measured, the dashed line simulated from the shown schedule. Green is the allowed range, stricter during shifts.",
  },
  efficiency: {
    title: "Boiler efficiency and chiller COP",
    text: "How much electricity the heat or cold takes. Heating costs its energy divided by the boiler efficiency. Cooling costs its energy divided by the chiller COP (coefficient of performance), so a COP of 3 means 1 kWh of electricity removes 3 kWh of heat.",
  },
  feasible: {
    title: "Feasible",
    text: "Yes when the simulated schedule breaks no comfort or equipment limit at any step. A number shows how many limit violations were found. This checks the plan, not what the sensors measured.",
  },
  pastLimit: {
    title: "Past limit",
    text: "How far a sensor reading went outside the allowed band at that moment.",
  },
  maintenanceWindow: {
    title: "Maintenance window",
    text: "Records that an asset (fan, boiler or chiller) is unavailable between two times. It is a record for now: adding one does not change the schedules or costs shown on this page.",
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;
