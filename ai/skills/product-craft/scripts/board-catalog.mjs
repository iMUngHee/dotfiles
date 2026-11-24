// The product-craft board catalog: the A2UI v1.0 basic catalog plus the board's own
// components and showCandidate. Importable in Node without React. Node gets the API-only
// catalog for validation and `board.mjs catalog`. The panel passes React implementations of
// the same names to buildBoardCatalog.
import { z } from "zod";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { createFunctionImplementation } from "@a2ui/web_core";
import {
  spec, ActionSchema, CheckRuleSchema, DynamicNumberSchema, DynamicStringSchema, DynamicValueSchema,
} from "@a2ui/web_core/v1_0";
import { ALIGN_OPTIONS, LIMITS } from "./board-controls.mjs";

export const BOARD_CATALOG_ID = "product-craft/board/v1";

const text = description => DynamicStringSchema.describe(`REF:#/$defs/DynamicString|${description}`);
const token = z.string().max(LIMITS.tokenLength)
  .describe(`CSS custom property name without the leading --, declared on the candidates' :root. At most ${LIMITS.tokenLength} characters.`);
const int = z.number().int().min(LIMITS.intMin).max(LIMITS.intMax);
const checks = z.array(CheckRuleSchema.describe("REF:#/$defs/CheckRule")).describe("Validation checks; the first failing message shows under the control.").optional();
const strict = (shape, options) => spec(z.object(shape).strict(), options);

export const BOARD_COMPONENT_APIS = [
  {
    name: "CandidatePicker",
    schema: strict({
      label: text("Label above the candidate cards."),
      value: DynamicStringSchema.describe("REF:#/$defs/DynamicString|Bind to /feedback/choice. Holds the chosen candidate number as a string."),
    }),
  },
  { name: "Heading", schema: strict({ text: text("Heading text."), level: z.number().int().min(1).max(2).optional().describe("1 or 2; 1 when omitted.") }) },
  { name: "Hint", schema: strict({ text: text("Secondary text, upright.") }) },
  {
    name: "SubmitButton",
    schema: strict({
      "@checks": checks,
      label: text("Button text."),
      variant: z.enum(["primary", "secondary"]).optional().describe("primary for the main answer; secondary otherwise."),
      dropsChoice: z.boolean().optional().describe("true when sending this answer discards the chosen candidate and its adjustments; the button then says so while one is chosen."),
      action: ActionSchema.describe("REF:#/$defs/Action"),
    }, { mixins: ["Checkable"] }),
  },
  {
    name: "CommentField",
    schema: strict({
      label: text("Label above the field."),
      placeholder: text("Placeholder text.").optional(),
      value: DynamicStringSchema.describe("REF:#/$defs/DynamicString|Bind to /feedback/comment."),
    }),
  },
  {
    name: "ColorToken",
    schema: strict({
      token, label: text("Label."),
      initial: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("The candidate's own value, #rrggbb."),
      value: DynamicStringSchema.describe("REF:#/$defs/DynamicString|Bind to /adjust/<token>."),
    }),
  },
  {
    name: "SizeNudge",
    schema: strict({
      token, label: text("Label."),
      initial: int.describe("The candidate's own value in px."), min: int, max: int, step: int.min(1),
      value: DynamicNumberSchema.describe("REF:#/$defs/DynamicNumber|Bind to /adjust/<token>."),
    }),
  },
  {
    name: "AlignPicker",
    schema: strict({
      token, label: text("Label."),
      initial: z.enum(ALIGN_OPTIONS), options: z.array(z.enum(ALIGN_OPTIONS)).min(1),
      value: DynamicStringSchema.describe("REF:#/$defs/DynamicString|Bind to /adjust/<token>."),
    }),
  },
  {
    name: "RegionNotes",
    schema: strict({
      label: text("Label."),
      value: DynamicValueSchema.describe(`Bind to /pins. Holds at most ${LIMITS.pins} pins for the round.`),
    }),
  },
];

export const SHOW_CANDIDATE_API = {
  name: "showCandidate",
  returnType: "void",
  description: "Shows the given candidate in the viewer without choosing it.",
  schema: z.object({ number: z.string().regex(/^[1-9]$/) }).strict(),
};

/** Builds the board catalog from component entries and the showCandidate implementation. */
export function buildBoardCatalog(components, showCandidate) {
  return basicCatalog.derive({
    catalogId: BOARD_CATALOG_ID,
    components: [...basicCatalog.components.keys(), ...components],
    functions: [...basicCatalog.functions.keys(), createFunctionImplementation(SHOW_CANDIDATE_API, showCandidate)],
  });
}

/** The catalog Node validates surfaces against; showCandidate does nothing outside a page. */
export const boardCatalog = buildBoardCatalog(BOARD_COMPONENT_APIS, () => {});
