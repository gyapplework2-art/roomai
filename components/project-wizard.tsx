"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject } from "@/lib/projects/actions";
import {
  COLOR_MOODS,
  FURNITURE,
  initialWizardData,
  labelize,
  MATERIAL_GROUPS,
  PRIORITIES,
  ROOM_FUNCTIONS,
  ROOM_TYPES,
  SPECIAL_REQUIREMENTS,
  STYLES,
  type WizardData,
  type WizardStep,
  validateStep,
} from "@/lib/projects/validation";

const steps = [
  "Room",
  "Function",
  "Style & Colors",
  "Materials",
  "Furniture",
  "Budget",
  "Review",
] as const;

const fieldClassName = "mt-2 bg-white";
const selectClassName =
  "mt-2 flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const textareaClassName =
  "mt-2 min-h-28 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-red-600">{message}</p> : null;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function ChoiceList({
  values,
  selected,
  onChange,
  columns = "sm:grid-cols-2",
}: {
  values: readonly string[];
  selected: string[];
  onChange: (value: string, checked: boolean) => void;
  columns?: string;
}) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {values.map((value) => (
        <label key={value} className="flex cursor-pointer items-center gap-3 border border-slate-200 bg-white px-4 py-3 text-sm transition-colors hover:border-slate-400">
          <Checkbox checked={selected.includes(value)} onCheckedChange={(checked) => onChange(value, checked === true)} />
          <span>{labelize(value)}</span>
        </label>
      ))}
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</h3>
      <p className="mt-2 text-sm text-slate-900">{items.length ? items.map(labelize).join(", ") : "None selected"}</p>
    </div>
  );
}

export function ProjectWizard() {
  const [step, setStep] = useState<WizardStep>(1);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function updateSection<K extends keyof WizardData>(section: K, value: WizardData[K]) {
    setData((current) => ({ ...current, [section]: value }));
    setErrors({});
    setSaveMessage("");
  }

  function changeList(section: "function" | "materials" | "furniture", key: string, value: string, checked: boolean) {
    const currentSection = data[section];
    const currentList = currentSection[key as keyof typeof currentSection] as string[];
    const nextList = checked ? [...currentList, value] : currentList.filter((item) => item !== value);
    const nextSection = { ...currentSection, [key]: nextList } as Record<string, unknown>;

    if (section === "materials" && (key === "preferred" || key === "avoid")) {
      const oppositeKey = key === "preferred" ? "avoid" : "preferred";
      const materialSection = currentSection as WizardData["materials"];
      nextSection[oppositeKey] = materialSection[oppositeKey].filter((item) => item !== value);
    }

    if (section === "furniture" && (key === "mustHave" || key === "niceToHave")) {
      const oppositeKey = key === "mustHave" ? "niceToHave" : "mustHave";
      const furnitureSection = currentSection as WizardData["furniture"];
      nextSection[oppositeKey] = furnitureSection[oppositeKey].filter((item) => item !== value);
    }

    updateSection(section, nextSection as WizardData[typeof section]);
  }

  function goNext() {
    const nextErrors = validateStep(step, data);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setStep((current) => (current < 7 ? (current + 1) as WizardStep : current));
  }

  function goBack() {
    setErrors({});
    setSaveMessage("");
    setStep((current) => (current > 1 ? (current - 1) as WizardStep : current));
  }

  function updateRoom(key: keyof WizardData["room"], value: string) {
    updateSection("room", { ...data.room, [key]: value });
  }

  function updateFunction(key: keyof WizardData["function"], value: string) {
    updateSection("function", { ...data.function, [key]: value });
  }

  function updateStyle(key: keyof WizardData["style"], value: string) {
    updateSection("style", { ...data.style, [key]: value });
  }

  function updateBudget(key: keyof WizardData["budget"], value: string) {
    updateSection("budget", { ...data.budget, [key]: value });
  }

  function handleCreateProject() {
    const nextErrors = validateStep(1, data);
    const styleErrors = validateStep(3, data);
    const budgetErrors = validateStep(6, data);
    const allErrors = { ...nextErrors, ...styleErrors, ...budgetErrors };

    if (Object.keys(allErrors).length) {
      setErrors(allErrors);
      setSaveMessage("Please review the highlighted details before creating your project.");
      return;
    }

    setErrors({});
    setSaveMessage("");
    startTransition(() => {
      void createProject(data).then((result) => {
        if (result.error) {
          setSaveMessage(result.error);
        }
      });
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-14">
      <div className="mb-10 overflow-x-auto pb-2">
        <ol className="flex min-w-[42rem] items-center">
          {steps.map((label, index) => {
            const stepNumber = (index + 1) as WizardStep;
            const active = stepNumber === step;
            const complete = stepNumber < step;
            return (
              <li key={label} className="flex flex-1 items-center">
                <button type="button" onClick={() => stepNumber < step && setStep(stepNumber)} className={`flex items-center gap-2 text-left text-xs font-medium ${active ? "text-slate-950" : complete ? "text-slate-600" : "text-slate-400"}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${active ? "border-slate-950 bg-slate-950 text-white" : complete ? "border-slate-600 bg-slate-600 text-white" : "border-slate-300 bg-transparent"}`}>
                    {complete ? <Check className="h-4 w-4" /> : stepNumber}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
                {stepNumber < 7 && <span className={`mx-3 h-px flex-1 ${complete ? "bg-slate-600" : "bg-slate-200"}`} />}
              </li>
            );
          })}
        </ol>
      </div>

      <section className="border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.04)] sm:p-10">
        {step === 1 && (
          <>
            <SectionHeading eyebrow="Step 1 of 7" title="Tell us about the room" description="Start with the basics. You can refine the details as your design takes shape." />
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="project-name">Project name</Label>
                <Input id="project-name" className={fieldClassName} value={data.room.projectName} onChange={(event) => updateRoom("projectName", event.target.value)} placeholder="Living room refresh" />
                <FieldError message={errors.projectName} />
              </div>
              <div>
                <Label htmlFor="room-type">Room type</Label>
                <select id="room-type" className={selectClassName} value={data.room.roomType} onChange={(event) => updateRoom("roomType", event.target.value)}>
                  <option value="">Choose a room</option>
                  {ROOM_TYPES.map((roomType) => <option key={roomType} value={roomType}>{labelize(roomType)}</option>)}
                </select>
                <FieldError message={errors.roomType} />
              </div>
              <div>
                <Label htmlFor="units">Units</Label>
                <select id="units" className={selectClassName} value={data.room.units} onChange={(event) => updateRoom("units", event.target.value)}>
                  <option value="imperial">Imperial (feet)</option>
                  <option value="metric">Metric (meters)</option>
                </select>
              </div>
              {(["width", "length", "height"] as const).map((dimension) => (
                <div key={dimension}>
                  <Label htmlFor={dimension}>{labelize(dimension)} {dimension === "height" && <span className="font-normal text-slate-500">(optional)</span>}</Label>
                  <div className="relative">
                    <Input id={dimension} type="number" min="0" step="any" className={fieldClassName} value={data.room[dimension]} onChange={(event) => updateRoom(dimension, event.target.value)} placeholder="0" />
                    <span className="pointer-events-none absolute right-3 top-2 text-xs text-slate-500">{data.room.units === "imperial" ? "ft" : "m"}</span>
                  </div>
                  <FieldError message={errors[dimension]} />
                </div>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <SectionHeading eyebrow="Step 2 of 7" title="How will you use the room?" description="Choose every function that should be supported by the final design." />
            <div className="space-y-8">
              <div><Label className="mb-3 block">Room functions</Label><ChoiceList values={ROOM_FUNCTIONS} selected={data.function.roomFunctions} onChange={(value, checked) => changeList("function", "roomFunctions", value, checked)} /></div>
              <div><Label htmlFor="household-size">Household size <span className="font-normal text-slate-500">(optional)</span></Label><Input id="household-size" className={fieldClassName} value={data.function.householdSize} onChange={(event) => updateFunction("householdSize", event.target.value)} placeholder="e.g. 2 adults and 1 child" /></div>
              <div><Label className="mb-3 block">Special requirements</Label><ChoiceList values={SPECIAL_REQUIREMENTS} selected={data.function.specialRequirements} onChange={(value, checked) => changeList("function", "specialRequirements", value, checked)} /></div>
              <div><Label htmlFor="additional-notes">Additional notes <span className="font-normal text-slate-500">(optional)</span></Label><textarea id="additional-notes" className={textareaClassName} value={data.function.additionalNotes} onChange={(event) => updateFunction("additionalNotes", event.target.value)} placeholder="Anything else we should know about this room?" /></div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <SectionHeading eyebrow="Step 3 of 7" title="Set the design direction" description="Pick a style foundation and the colors that should guide the room." />
            <div className="grid gap-6 sm:grid-cols-2">
              <div><Label htmlFor="primary-style">Primary style</Label><select id="primary-style" className={selectClassName} value={data.style.primaryStyle} onChange={(event) => updateStyle("primaryStyle", event.target.value)}><option value="">Choose a style</option>{STYLES.map((style) => <option key={style} value={style}>{style}</option>)}</select><FieldError message={errors.primaryStyle} /></div>
              <div><Label htmlFor="secondary-style">Secondary style <span className="font-normal text-slate-500">(optional)</span></Label><select id="secondary-style" className={selectClassName} value={data.style.secondaryStyle} onChange={(event) => updateStyle("secondaryStyle", event.target.value)}><option value="">None</option>{STYLES.filter((style) => style !== data.style.primaryStyle).map((style) => <option key={style} value={style}>{style}</option>)}</select></div>
              <div><Label htmlFor="color-mood">Color mood</Label><select id="color-mood" className={selectClassName} value={data.style.colorMood} onChange={(event) => updateStyle("colorMood", event.target.value)}><option value="">Choose a mood</option>{COLOR_MOODS.map((mood) => <option key={mood} value={mood}>{labelize(mood)}</option>)}</select></div>
              {["primaryColor", "secondaryColor", "accentColor", "metalColor"].map((color) => <div key={color}><Label htmlFor={color}>{labelize(color)} <span className="font-normal text-slate-500">(optional)</span></Label><Input id={color} className={fieldClassName} value={data.style[color as keyof WizardData["style"]]} onChange={(event) => updateStyle(color as keyof WizardData["style"], event.target.value)} placeholder="e.g. soft white" /></div>)}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <SectionHeading eyebrow="Step 4 of 7" title="Choose your materials" description="Tell us what to bring into the room and what to leave out." />
            <div className="grid gap-8 lg:grid-cols-2"><div><h2 className="mb-4 text-lg font-semibold">Preferred</h2><div className="space-y-6">{MATERIAL_GROUPS.map((group) => <div key={group.label}><p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</p><ChoiceList values={group.items} selected={data.materials.preferred} onChange={(value, checked) => changeList("materials", "preferred", value, checked)} columns="grid-cols-2" /></div>)}</div></div><div><h2 className="mb-4 text-lg font-semibold">Avoid</h2><div className="space-y-6">{MATERIAL_GROUPS.map((group) => <div key={group.label}><p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</p><ChoiceList values={group.items} selected={data.materials.avoid} onChange={(value, checked) => changeList("materials", "avoid", value, checked)} columns="grid-cols-2" /></div>)}</div></div></div>
            <p className="mt-8 text-sm text-slate-500">A material selected as Preferred is automatically removed from Avoid, and vice versa.</p>
          </>
        )}

        {step === 5 && (
          <>
            <SectionHeading eyebrow="Step 5 of 7" title="Prioritize the furniture" description="Select the pieces that matter most, then the pieces that would be nice additions." />
            <div className="grid gap-8 lg:grid-cols-2"><div><h2 className="mb-4 text-lg font-semibold">Must Have</h2><ChoiceList values={FURNITURE} selected={data.furniture.mustHave} onChange={(value, checked) => changeList("furniture", "mustHave", value, checked)} /></div><div><h2 className="mb-4 text-lg font-semibold">Nice to Have</h2><ChoiceList values={FURNITURE} selected={data.furniture.niceToHave} onChange={(value, checked) => changeList("furniture", "niceToHave", value, checked)} /></div></div>
            <p className="mt-8 text-sm text-slate-500">An item selected as Must Have is automatically removed from Nice to Have, and vice versa.</p>
          </>
        )}

        {step === 6 && (
          <>
            <SectionHeading eyebrow="Step 6 of 7" title="Set your budget" description="Give the design a comfortable range and tell us what to optimize for." />
            <div className="grid gap-6 sm:grid-cols-2"><div><Label htmlFor="currency">Currency</Label><select id="currency" className={selectClassName} value={data.budget.currency} onChange={(event) => updateBudget("currency", event.target.value)}><option value="USD">USD</option><option value="CAD">CAD</option></select></div><div><Label htmlFor="priority">Priority</Label><select id="priority" className={selectClassName} value={data.budget.priority} onChange={(event) => updateBudget("priority", event.target.value)}><option value="">Choose a priority</option>{PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}</select></div><div><Label htmlFor="budget-minimum">Budget minimum <span className="font-normal text-slate-500">(optional)</span></Label><Input id="budget-minimum" type="number" min="0" step="any" className={fieldClassName} value={data.budget.minimum} onChange={(event) => updateBudget("minimum", event.target.value)} placeholder="0" /><FieldError message={errors.minimum} /></div><div><Label htmlFor="budget-maximum">Budget maximum <span className="font-normal text-slate-500">(optional)</span></Label><Input id="budget-maximum" type="number" min="0" step="any" className={fieldClassName} value={data.budget.maximum} onChange={(event) => updateBudget("maximum", event.target.value)} placeholder="0" /><FieldError message={errors.maximum} /></div></div>
          </>
        )}

        {step === 7 && (
          <>
            <SectionHeading eyebrow="Step 7 of 7" title="Review your room" description="Everything looks good? Review your choices, then create the project when saving is connected." />
            <div className="space-y-8"><div className="grid gap-6 border-b border-slate-200 pb-8 sm:grid-cols-2"><SummaryList title="Project" items={[data.room.projectName || "Unnamed project", data.room.roomType ? labelize(data.room.roomType) : "No room type"]} /><SummaryList title="Dimensions" items={[`${data.room.width || "-"} x ${data.room.length || "-"}${data.room.height ? ` x ${data.room.height}` : ""} ${data.room.units === "imperial" ? "ft" : "m"}`]} /></div><div className="grid gap-6 border-b border-slate-200 pb-8 sm:grid-cols-2"><SummaryList title="Room functions" items={data.function.roomFunctions} /><SummaryList title="Special requirements" items={data.function.specialRequirements} /><SummaryList title="Household size" items={[data.function.householdSize || "Not specified"]} /><SummaryList title="Additional notes" items={[data.function.additionalNotes || "None"]} /></div><div className="grid gap-6 border-b border-slate-200 pb-8 sm:grid-cols-2"><SummaryList title="Styles" items={[data.style.primaryStyle, data.style.secondaryStyle].filter(Boolean)} /><SummaryList title="Color mood" items={[data.style.colorMood ? labelize(data.style.colorMood) : "Not specified"]} /><SummaryList title="Colors" items={[data.style.primaryColor, data.style.secondaryColor, data.style.accentColor, data.style.metalColor].filter(Boolean)} /></div><div className="grid gap-6 border-b border-slate-200 pb-8 sm:grid-cols-2"><SummaryList title="Preferred Materials" items={data.materials.preferred} /><SummaryList title="Avoid Materials" items={data.materials.avoid} /></div><div className="grid gap-6 border-b border-slate-200 pb-8 sm:grid-cols-2"><SummaryList title="Must Have" items={data.furniture.mustHave} /><SummaryList title="Nice to Have" items={data.furniture.niceToHave} /></div><div className="grid gap-6 sm:grid-cols-2"><SummaryList title="Budget" items={[data.budget.minimum || "No minimum", data.budget.maximum || "No maximum"].map((item) => item === "No minimum" || item === "No maximum" ? item : `${data.budget.currency} ${item}`)} /><SummaryList title="Priority" items={[PRIORITIES.find((priority) => priority.value === data.budget.priority)?.label || "Not specified"]} /></div></div>
            {saveMessage && <p className="mt-8 border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">{saveMessage}</p>}
          </>
        )}

        <div className="mt-10 flex flex-col-reverse gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={goBack} disabled={step === 1}><ArrowLeft />Back</Button>
          {step < 7 ? <Button type="button" onClick={goNext}>Continue<ArrowRight /></Button> : <Button type="button" onClick={handleCreateProject} disabled={isPending}>{isPending ? "Creating Project..." : "Create Project"}<Check /></Button>}
        </div>
      </section>
    </div>
  );
}