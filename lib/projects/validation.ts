export const ROOM_TYPES = [
  "living_room",
  "bedroom",
  "dining_room",
  "home_office",
  "family_room",
  "guest_room",
  "other",
] as const;

export const ROOM_FUNCTIONS = [
  "watching_tv",
  "entertaining",
  "reading",
  "working",
  "gaming",
  "children",
  "relaxation",
  "other",
] as const;

export const SPECIAL_REQUIREMENTS = [
  "storage",
  "child_friendly",
  "pet_friendly",
  "easy_to_clean",
  "accessibility",
] as const;

export const STYLES = [
  "Modern",
  "Warm Modern",
  "Contemporary",
  "Minimalist",
  "Scandinavian",
  "Mid-Century Modern",
  "Traditional",
  "Transitional",
  "Industrial",
  "Japandi",
  "Coastal",
  "Farmhouse",
  "Bohemian",
  "Art Deco",
  "Luxury Modern",
] as const;

export const COLOR_MOODS = ["light", "warm", "dark", "neutral", "colorful"] as const;

export const MATERIAL_GROUPS = [
  { label: "Wood", items: ["walnut", "oak", "maple", "cherry", "painted wood"] },
  { label: "Metal", items: ["brass", "chrome", "black steel", "stainless steel"] },
  { label: "Fabric", items: ["linen", "wool", "velvet", "leather"] },
  { label: "Other", items: ["glass", "marble", "ceramic", "acrylic"] },
] as const;

export const FURNITURE = [
  "sofa",
  "sectional",
  "accent chair",
  "coffee table",
  "side table",
  "console",
  "bookshelf",
  "TV unit",
  "rug",
  "floor lamp",
  "table lamp",
  "artwork",
  "desk",
  "bed",
  "nightstand",
  "dresser",
] as const;

export const PRIORITIES = [
  { value: "lowest_price", label: "Lowest Price" },
  { value: "best_value", label: "Best Value" },
  { value: "design_quality", label: "Design Quality" },
  { value: "premium_quality", label: "Premium Quality" },
] as const;

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Units = "imperial" | "metric";
export type RoomType = (typeof ROOM_TYPES)[number];

export type WizardData = {
  room: {
    projectName: string;
    roomType: RoomType | "";
    width: string;
    length: string;
    height: string;
    units: Units;
  };
  function: {
    roomFunctions: string[];
    householdSize: string;
    specialRequirements: string[];
    additionalNotes: string;
  };
  style: {
    primaryStyle: string;
    secondaryStyle: string;
    colorMood: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    metalColor: string;
  };
  materials: {
    preferred: string[];
    avoid: string[];
  };
  furniture: {
    mustHave: string[];
    niceToHave: string[];
  };
  budget: {
    currency: "USD" | "CAD";
    minimum: string;
    maximum: string;
    priority: string;
  };
};

export const initialWizardData: WizardData = {
  room: {
    projectName: "",
    roomType: "",
    width: "",
    length: "",
    height: "",
    units: "imperial",
  },
  function: {
    roomFunctions: [],
    householdSize: "",
    specialRequirements: [],
    additionalNotes: "",
  },
  style: {
    primaryStyle: "",
    secondaryStyle: "",
    colorMood: "",
    primaryColor: "",
    secondaryColor: "",
    accentColor: "",
    metalColor: "",
  },
  materials: { preferred: [], avoid: [] },
  furniture: { mustHave: [], niceToHave: [] },
  budget: { currency: "USD", minimum: "", maximum: "", priority: "" },
};

export function labelize(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function positiveNumber(value: string) {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
}

function nonNegativeNumber(value: string) {
  return value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0);
}

export function validateStep(step: WizardStep, data: WizardData) {
  const errors: Record<string, string> = {};

  if (step === 1) {
    if (!data.room.projectName.trim()) errors.projectName = "Enter a project name.";
    if (!data.room.roomType) errors.roomType = "Choose a room type.";
    if (!positiveNumber(data.room.width)) errors.width = "Width must be greater than 0.";
    if (!positiveNumber(data.room.length)) errors.length = "Length must be greater than 0.";
    if (data.room.height && !positiveNumber(data.room.height)) {
      errors.height = "Height must be greater than 0.";
    }
  }

  if (step === 4 && !data.style.primaryStyle) {
    errors.primaryStyle = "Choose a primary style.";
  }

  if (step === 7) {
    if (!nonNegativeNumber(data.budget.minimum)) errors.minimum = "Use 0 or a positive amount.";
    if (!nonNegativeNumber(data.budget.maximum)) errors.maximum = "Use 0 or a positive amount.";
    if (
      data.budget.minimum &&
      data.budget.maximum &&
      Number(data.budget.maximum) < Number(data.budget.minimum)
    ) {
      errors.maximum = "Maximum must be greater than or equal to minimum.";
    }
  }

  return errors;
}