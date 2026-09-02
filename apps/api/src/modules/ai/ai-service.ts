import { repositories } from '@aisbp/database';
import {
  aiBookingIntentSchema,
  missingIntentFields,
  type AiAvailabilityRequest,
  type AiAvailabilityResponse,
  type AiBookingIntent,
  type AiIntentField,
  type AiIntentResponse,
  type AiMatchedService,
  type CatalogueService,
} from '@aisbp/shared';
import { AppError } from '../../lib/errors.js';
import { getClaudeClient } from '../../lib/claude.js';
import { logger } from '../../lib/logger.js';
import { availabilityService } from '../availability/availability-service.js';
import { catalogueService } from '../catalogue/catalogue-service.js';
import {
  RECORD_INTENT_TOOL,
  buildAvailabilitySystemPrompt,
  buildAvailabilityUserContent,
  buildClarifyUserContent,
  buildIntentSystemPrompt,
} from './ai-prompts.js';
import type { AiOperation } from '../../lib/claude.js';

const SERVICE_CONTEXT_LIMIT = 48;

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function todayIsoUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Keep only a well-formed future (or today) `YYYY-MM-DD`; string compare is safe for ISO dates. */
function groundDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return value >= todayIsoUtc() ? value : null;
}

function synthesiseClarification(
  missing: AiIntentField[],
  services: Array<{ name: string }>,
): string {
  const parts: string[] = [];
  if (missing.includes('service')) {
    const examples = services
      .slice(0, 3)
      .map((s) => s.name)
      .join(', ');
    parts.push(
      examples
        ? `Which service do you need — for example ${examples}?`
        : 'Which service do you need?',
    );
  }
  if (missing.includes('date')) parts.push('What date works for you?');
  if (missing.includes('address')) parts.push('Which of your saved addresses should I use?');
  return parts.join(' ');
}

function toMatchedService(service: CatalogueService): AiMatchedService {
  return {
    slug: service.slug,
    name: service.name,
    priceCents: service.priceCents,
    currency: service.currency,
    durationMinutes: service.durationMinutes,
  };
}

function fallbackIntentResponse(operation: AiOperation, reason: string): AiIntentResponse {
  logger.info('ai.validation', { operation, outcome: 'fallback', reason });
  return {
    intent: {
      serviceSlug: null,
      serviceCandidateSlugs: [],
      requestedDate: null,
      requestedTimeOfDay: null,
      addressId: null,
      notes: null,
      missingFields: ['service', 'date', 'address'],
      clarificationQuestion:
        "Sorry, I didn't quite catch that. Which service do you need, on what date, and at which of your saved addresses?",
      confidence: 'low',
    },
    matchedService: null,
    assistantMessage: "I couldn't work that out yet — could you give me a bit more detail?",
  };
}

interface GroundingInputs {
  operation: AiOperation;
  raw: unknown;
  services: CatalogueService[];
  addressIds: Set<string>;
}

/** Re-ground every model-produced field against real records. Server-authoritative. */
function groundIntent({ operation, raw, services, addressIds }: GroundingInputs): AiIntentResponse {
  const parsed = aiBookingIntentSchema.safeParse(raw);
  if (!parsed.success) {
    return fallbackIntentResponse(operation, 'model output failed schema validation');
  }
  const model = parsed.data;
  const bySlug = new Map(services.map((s) => [s.slug, s]));

  let serviceSlug = model.serviceSlug && bySlug.has(model.serviceSlug) ? model.serviceSlug : null;
  const candidates = [...new Set(model.serviceCandidateSlugs)]
    .filter((slug) => bySlug.has(slug) && slug !== serviceSlug)
    .slice(0, 8);
  if (!serviceSlug && candidates.length === 1) {
    serviceSlug = candidates.shift() ?? null;
  }

  const addressId = model.addressId && addressIds.has(model.addressId) ? model.addressId : null;
  const requestedDate = groundDate(model.requestedDate);
  const missingFields = missingIntentFields({ serviceSlug, requestedDate, addressId });
  const matched = serviceSlug ? (bySlug.get(serviceSlug) ?? null) : null;

  const clarificationQuestion =
    missingFields.length > 0
      ? (model.clarificationQuestion ?? synthesiseClarification(missingFields, services))
      : null;

  const intent: AiBookingIntent = {
    serviceSlug,
    serviceCandidateSlugs: candidates,
    requestedDate,
    requestedTimeOfDay: model.requestedTimeOfDay,
    addressId,
    notes: model.notes ? model.notes.slice(0, 500) : null,
    missingFields,
    clarificationQuestion,
    confidence: model.confidence,
  };

  const assistantMessage =
    matched && requestedDate && addressId
      ? `Got it — ${matched.name} on ${requestedDate}. You can review and confirm the booking next.`
      : `Here's what I have so far. ${clarificationQuestion ?? ''}`.trim();

  logger.info('ai.validation', { operation, outcome: 'ok', missing: missingFields.length });
  return { intent, matchedService: matched ? toMatchedService(matched) : null, assistantMessage };
}

async function loadContext(userId: string): Promise<{
  services: CatalogueService[];
  addressIds: Set<string>;
  addressContext: Array<{ id: string; label: string; city: string }>;
}> {
  const [serviceList, addresses] = await Promise.all([
    catalogueService.listServices({ sort: 'name_asc', page: 1, limit: SERVICE_CONTEXT_LIMIT }),
    repositories.addresses.listByUser(userId),
  ]);
  return {
    services: serviceList.items,
    addressIds: new Set(addresses.map((a) => a.id)),
    // Data minimisation: only id + label + city ever reach the model.
    addressContext: addresses.map((a) => ({ id: a.id, label: a.label, city: a.city })),
  };
}

function requireClient(): NonNullable<ReturnType<typeof getClaudeClient>> {
  const client = getClaudeClient();
  if (!client) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'The booking assistant is not available right now. You can still book directly.',
    );
  }
  return client;
}

export const aiService = {
  async extractIntent(userId: string, message: string): Promise<AiIntentResponse> {
    const client = requireClient();
    const { services, addressIds, addressContext } = await loadContext(userId);
    const system = buildIntentSystemPrompt({
      todayIso: todayIsoUtc(),
      services: services.map((s) => ({ slug: s.slug, name: s.name })),
      addresses: addressContext,
    });

    let raw: unknown;
    try {
      const result = await client.extractStructured({
        operation: 'intent',
        system,
        userContent: message,
        tool: RECORD_INTENT_TOOL,
        maxTokens: 1024,
      });
      raw = result.data;
    } catch (error) {
      logger.warn('ai.error', { operation: 'intent', message: errText(error) });
      return fallbackIntentResponse('intent', 'claude call failed');
    }
    return groundIntent({ operation: 'intent', raw, services, addressIds });
  },

  async clarifyIntent(
    userId: string,
    message: string,
    priorIntent: AiBookingIntent,
  ): Promise<AiIntentResponse> {
    const client = requireClient();
    const { services, addressIds, addressContext } = await loadContext(userId);
    const system = buildIntentSystemPrompt({
      todayIso: todayIsoUtc(),
      services: services.map((s) => ({ slug: s.slug, name: s.name })),
      addresses: addressContext,
    });

    let raw: unknown;
    try {
      const result = await client.extractStructured({
        operation: 'clarify',
        system,
        userContent: buildClarifyUserContent(JSON.stringify(priorIntent), message),
        tool: RECORD_INTENT_TOOL,
        maxTokens: 1024,
      });
      raw = result.data;
    } catch (error) {
      logger.warn('ai.error', { operation: 'clarify', message: errText(error) });
      return fallbackIntentResponse('clarify', 'claude call failed');
    }
    return groundIntent({ operation: 'clarify', raw, services, addressIds });
  },

  async assistAvailability(
    _userId: string,
    request: AiAvailabilityRequest,
  ): Promise<AiAvailabilityResponse> {
    // Throws NOT_FOUND for an unknown/inactive slug — same as the public endpoint.
    const service = await catalogueService.getServiceBySlug(request.serviceSlug);
    const availability = await availabilityService.publicForService(request.serviceSlug, {
      from: request.from ? new Date(request.from) : undefined,
      to: request.to ? new Date(request.to) : undefined,
    });
    const slots = availability.items;

    const templateAnswer =
      slots.length === 0
        ? `There are no available appointments for ${service.name} in that window.`
        : `There ${slots.length === 1 ? 'is 1 slot' : `are ${slots.length} slots`} available for ${service.name}, the earliest starting ${slots[0]?.startsAt ?? ''}.`;

    let answer = templateAnswer;
    const client = getClaudeClient();
    if (slots.length > 0 && client) {
      try {
        const result = await client.generateText({
          operation: 'availability',
          system: buildAvailabilitySystemPrompt(),
          userContent: buildAvailabilityUserContent({
            serviceName: service.name,
            question: request.message,
            slots: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
            window: availability.window,
          }),
          maxTokens: 400,
        });
        answer = result.text || templateAnswer;
        logger.info('ai.validation', {
          operation: 'availability',
          outcome: result.text ? 'ok' : 'fallback',
        });
      } catch (error) {
        logger.warn('ai.error', { operation: 'availability', message: errText(error) });
      }
    }

    return {
      service: { slug: service.slug, name: service.name },
      answer,
      // Slots always come from PostgreSQL via the availability service, never the model.
      slots,
      window: availability.window,
    };
  },
};
