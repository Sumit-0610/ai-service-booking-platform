import { aiIntentFieldValues, aiTimeOfDayValues } from '@aisbp/shared';

/**
 * Prompt + tool-schema construction for the booking assistant. Kept together so
 * the instruction text and the forced-tool JSON schema stay in sync with the
 * shared `aiBookingIntentSchema`.
 */

export const RECORD_INTENT_TOOL = {
  name: 'record_booking_intent',
  description:
    'Record the structured booking intent extracted from the customer message. ' +
    'Only use slugs from the provided service list. Use null when a value is not ' +
    'stated. Never invent a date, address, or service.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'serviceSlug',
      'serviceCandidateSlugs',
      'requestedDate',
      'requestedTimeOfDay',
      'addressId',
      'notes',
      'missingFields',
      'clarificationQuestion',
      'confidence',
    ],
    properties: {
      serviceSlug: {
        type: ['string', 'null'],
        description: 'The single best-matching service slug from the list, or null.',
      },
      serviceCandidateSlugs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Other plausible service slugs from the list (may be empty).',
      },
      requestedDate: {
        type: ['string', 'null'],
        description:
          'Requested calendar date as YYYY-MM-DD (resolved to an absolute date), or null.',
      },
      requestedTimeOfDay: {
        type: ['string', 'null'],
        enum: [...aiTimeOfDayValues, null],
      },
      addressId: {
        type: ['string', 'null'],
        description: "The id of one of the customer's saved addresses, or null.",
      },
      notes: {
        type: ['string', 'null'],
        description:
          'Any short free-text detail the customer mentioned (access notes, etc.), or null.',
      },
      missingFields: {
        type: 'array',
        items: { type: 'string', enum: [...aiIntentFieldValues] },
      },
      clarificationQuestion: {
        type: ['string', 'null'],
        description:
          'A single question to ask if a required field is missing or ambiguous, else null.',
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
  } satisfies Record<string, unknown>,
};

interface IntentContext {
  todayIso: string;
  services: Array<{ slug: string; name: string }>;
  addresses: Array<{ id: string; label: string; city: string }>;
}

const INTENT_RULES = [
  'You are the booking assistant for a home service installation platform.',
  'Extract a structured booking intent from the customer message and call the record_booking_intent tool.',
  'Rules:',
  '- serviceSlug and serviceCandidateSlugs MUST be slugs taken verbatim from the SERVICES list. If nothing matches, use null / an empty array.',
  '- requestedDate must be an absolute YYYY-MM-DD date on or after TODAY. Resolve relative phrases ("next Saturday") against TODAY. If no date is stated, use null.',
  '- addressId must be an id from the ADDRESSES list (match on label or city). If the customer gives a new address or none, use null.',
  '- Do not guess. Prefer null and a clarificationQuestion over a low-confidence value.',
  '- Never include personal data beyond what the customer wrote.',
].join('\n');

export function buildIntentSystemPrompt(ctx: IntentContext): string {
  const services = ctx.services.map((s) => `- ${s.slug} : ${s.name}`).join('\n') || '- (none)';
  const addresses =
    ctx.addresses.map((a) => `- ${a.id} : ${a.label} (${a.city})`).join('\n') || '- (none)';
  return [
    INTENT_RULES,
    `TODAY: ${ctx.todayIso}`,
    `SERVICES:\n${services}`,
    `ADDRESSES:\n${addresses}`,
  ].join('\n\n');
}

export function buildClarifyUserContent(priorIntentJson: string, message: string): string {
  return [
    'The customer is refining an earlier request.',
    `Earlier structured intent: ${priorIntentJson}`,
    `New customer message: ${message}`,
    'Produce the updated full intent (carry forward earlier values unless the new message changes them).',
  ].join('\n');
}

interface AvailabilityContext {
  serviceName: string;
  question: string | undefined;
  slots: Array<{ startsAt: string; endsAt: string }>;
  window: { from: string; to: string };
}

export function buildAvailabilitySystemPrompt(): string {
  return [
    'You are the booking assistant for a home service installation platform.',
    'Summarise the available appointment slots for the customer in 1-3 short sentences.',
    'Only reference slots from the AVAILABLE SLOTS list. Never invent times or claim a slot that is not listed.',
    'Times are UTC ISO 8601. You may group them by day. Be concise and friendly.',
  ].join('\n');
}

export function buildAvailabilityUserContent(ctx: AvailabilityContext): string {
  const slots =
    ctx.slots.map((s) => `- ${s.startsAt} to ${s.endsAt}`).join('\n') || '- (no slots available)';
  return [
    `Service: ${ctx.serviceName}`,
    `Window: ${ctx.window.from} to ${ctx.window.to}`,
    ctx.question
      ? `Customer question: ${ctx.question}`
      : 'Customer question: (none — general availability)',
    `AVAILABLE SLOTS:\n${slots}`,
  ].join('\n');
}
