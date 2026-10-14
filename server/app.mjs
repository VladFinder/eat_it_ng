import { createServer } from 'node:http';
import { spoonacularMealTypes } from './recipe-types.mjs';
import { ZodError } from 'zod';
import webpush from 'web-push';
import { clientAddress, createAuthLimiter, isAllowedWriteOrigin } from './security.mjs';
import {
  authenticate,
  clearSessionCookie,
  createSession,
  hashPassword,
  hashToken,
  sessionCookie,
  verifyPassword,
} from './auth.mjs';
import {
  appleAuthorization,
  clearOauthCookie,
  cookieValue,
  exchangeAppleCode,
  exchangeGoogleCode,
  googleAuthorization,
  oauthCookie,
} from './oauth.mjs';
import {
  recipeCatalogQuerySchema,
  adminRecipeTranslationSchema,
  adminProductTranslationSchema,
  adminCatalogQuerySchema,
  adminSupportQuerySchema,
  consumeSchema,
  fridgeCreateSchema,
  fridgeUpdateSchema,
  feedbackCreateSchema,
  dishCreateSchema,
  householdMemberSchema,
  householdUpdateSchema,
  loginSchema,
  mealPlanCreateSchema,
  notificationPreferencesSchema,
  notificationUpdateSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  registerSchema,
  shoppingCreateSchema,
  shoppingToFridgeSchema,
  shoppingUpdateSchema,
  supportMessageCreateSchema,
  supportTicketCreateSchema,
  adminSubscriptionSchema,
  isTrustedPushEndpoint,
} from './validation.mjs';

const BODY_LIMIT = 64 * 1024;
const RECIPE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const recipeSuggestionsCache = new Map();
const CAPACITOR_ORIGINS = new Set([
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
]);

function applyCapacitorCors(request, response) {
  const origin = request.headers.origin;
  if (!CAPACITOR_ORIGINS.has(origin)) {
    return false;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  response.setHeader('Vary', 'Origin');
  return true;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    const error = new Error('Content-Type must be application/json');
    error.status = 415;
    throw error;
  }
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

async function readForm(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (body.length > BODY_LIMIT) {
      const error = new Error('Request body is too large');
      error.status = 413;
      throw error;
    }
  }
  return new URLSearchParams(body);
}

function toDate(value) {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`);
}

function serializeFridgeItem({ householdId, ...item }) {
  return {
    ...item,
    expiresAt: item.expiresAt ? item.expiresAt.toISOString().slice(0, 10) : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeShoppingItem({ householdId, ...item }) {
  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    householdId: user.householdId,
    authProvider: user.authProvider,
  };
}

function serializeDevUser(user) {
  const household = user.household;
  const periodActive =
    !household.subscriptionPeriodEnd || household.subscriptionPeriodEnd.getTime() > Date.now();
  const isPlus =
    household.plan === 'plus' &&
    ['active', 'trialing'].includes(household.subscriptionStatus) &&
    periodActive;
  return {
    ...serializeUser(user),
    createdAt: user.createdAt.toISOString(),
    householdName: household.name,
    subscription: {
      plan: isPlus ? 'plus' : 'free',
      status: household.subscriptionStatus,
      provider: household.subscriptionProvider,
      currentPeriodEnd: household.subscriptionPeriodEnd?.toISOString() ?? null,
      isPlus,
    },
  };
}

function serializeHousehold(household) {
  const currentPeriodEnd = household.subscriptionPeriodEnd ?? null;
  const subscriptionActive = ['active', 'trialing'].includes(household.subscriptionStatus);
  const periodActive = !currentPeriodEnd || currentPeriodEnd.getTime() > Date.now();
  const isPlus = household.plan === 'plus' && subscriptionActive && periodActive;

  return {
    id: household.id,
    name: household.name,
    members: household.users.map(serializeUser),
    subscription: {
      plan: isPlus ? 'plus' : 'free',
      status: household.subscriptionStatus,
      provider: household.subscriptionProvider,
      currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
      isPlus,
    },
  };
}

function serializeNotification(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt?.toISOString() ?? null,
    data: notification.data ? JSON.parse(notification.data) : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

function serializeMealPlanEntry(entry) {
  return {
    id: entry.id,
    date: entry.date.toISOString().slice(0, 10),
    mealType: entry.mealType,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    dish: {
      id: entry.dish.id,
      title: entry.dish.title,
      image: entry.dish.imageUrl ?? null,
      subtitle: entry.dish.subtitle,
      source: entry.dish.source,
    },
  };
}

function serializeSupportTicket(ticket) {
  const lastMessage = ticket.messages?.[0] ?? null;
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    user: ticket.user ? serializeUser(ticket.user) : undefined,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          authorRole: lastMessage.authorRole,
          body: lastMessage.body,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
  };
}

function serializeSupportMessage(message) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    authorRole: message.authorRole,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    author: message.author ? serializeUser(message.author) : undefined,
  };
}

function serializeFeedbackItem(item) {
  return {
    id: item.id,
    type: item.type,
    body: item.body,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    user: item.user ? serializeUser(item.user) : undefined,
  };
}

function spoonacularApiKey() {
  return process.env.SPOONACULAR_API_KEY ?? process.env.RECIPE_API_KEY ?? '';
}

function normalizeProductName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ');
}

const SPOONACULAR_INGREDIENTS = {
  'куриное филе': 'chicken breast',
  'цветная капуста': 'cauliflower',
  'сливочное масло': 'butter',
  'болгарский перец': 'bell pepper',
  картофель: 'potato',
  картошка: 'potato',
  помидоры: 'tomato',
  помидор: 'tomato',
  огурцы: 'cucumber',
  огурец: 'cucumber',
  морковь: 'carrot',
  лук: 'onion',
  чеснок: 'garlic',
  капуста: 'cabbage',
  перец: 'bell pepper',
  кабачок: 'zucchini',
  баклажан: 'eggplant',
  свекла: 'beet',
  брокколи: 'broccoli',
  грибы: 'mushrooms',
  яблоко: 'apple',
  яблоки: 'apple',
  банан: 'banana',
  молоко: 'milk',
  сыр: 'cheese',
  творог: 'cottage cheese',
  сметана: 'sour cream',
  йогурт: 'yogurt',
  яйца: 'eggs',
  яйцо: 'eggs',
  курица: 'chicken',
  говядина: 'beef',
  свинина: 'pork',
  фарш: 'ground meat',
  рыба: 'fish',
  лосось: 'salmon',
  рис: 'rice',
  макароны: 'pasta',
  гречка: 'buckwheat',
  овсянка: 'oats',
  мука: 'flour',
  фасоль: 'beans',
  горох: 'peas',
  хлеб: 'bread',
};

function spoonacularIngredientName(value) {
  const normalized = normalizeProductName(value);
  if (!/[а-я]/i.test(normalized)) return normalized;
  if (SPOONACULAR_INGREDIENTS[normalized]) return SPOONACULAR_INGREDIENTS[normalized];
  const match = Object.keys(SPOONACULAR_INGREDIENTS)
    .sort((left, right) => right.length - left.length)
    .find((name) => normalized.includes(name));
  return match ? SPOONACULAR_INGREDIENTS[match] : '';
}

const ENGLISH_INGREDIENT_ALIASES = {
  potatoes: 'potato',
  tomatoes: 'tomato',
  eggs: 'egg',
  mushrooms: 'mushroom',
  beans: 'bean',
  peas: 'pea',
  oats: 'oat',
};

function canonicalIngredientName(value) {
  const translated = spoonacularIngredientName(value) || normalizeProductName(value);
  return ENGLISH_INGREDIENT_ALIASES[translated] ?? translated;
}

function recipeTitle(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Рецепт';
}

function plainText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function recipeSteps(recipe) {
  if (!Array.isArray(recipe.analyzedInstructions)) return [];
  return recipe.analyzedInstructions
    .flatMap((section) => (Array.isArray(section.steps) ? section.steps : []))
    .map((step) => plainText(step.step))
    .filter(Boolean)
    .slice(0, 20);
}

function serializeRecipeSuggestion(recipe) {
  const used = Number(recipe.usedIngredientCount ?? recipe.usedIngredients?.length ?? 0);
  const missed = Number(recipe.missedIngredientCount ?? recipe.missedIngredients?.length ?? 0);
  const total = Math.max(used + missed, 1);
  const match = Math.round((used / total) * 100);
  return {
    id: String(recipe.id),
    title: recipeTitle(recipe.title),
    image: typeof recipe.image === 'string' ? recipe.image : null,
    source: 'spoonacular',
    mealTypes: spoonacularMealTypes(recipe.dishTypes),
    externalId: String(recipe.id),
    subtitle: recipe.readyInMinutes ? `${recipe.readyInMinutes} мин.` : null,
    description: plainText(recipe.summary),
    instructions: recipeSteps(recipe),
    usedIngredientCount: used,
    missedIngredientCount: missed,
    expiringIngredientCount: 0,
    matchPercent: match,
    usedIngredients: Array.isArray(recipe.usedIngredients)
      ? recipe.usedIngredients
          .map((item) => recipeTitle(item.name ?? item.originalName))
          .slice(0, 8)
      : [],
    missedIngredients: Array.isArray(recipe.missedIngredients)
      ? recipe.missedIngredients
          .map((item) => recipeTitle(item.name ?? item.originalName))
          .slice(0, 8)
      : [],
  };
}

async function fetchRecipeInformationBulk(apiKey, recipes) {
  const ids = recipes.map((recipe) => String(recipe.id)).filter(Boolean);
  if (!ids.length) return recipes;

  const params = new URLSearchParams({ apiKey, ids: ids.join(','), includeNutrition: 'false' });
  const response = await fetch(
    `https://api.spoonacular.com/recipes/informationBulk?${params.toString()}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    const error = new Error('Recipe information request failed');
    error.status = response.status === 402 || response.status === 429 ? 429 : 502;
    throw error;
  }

  const details = await response.json();
  if (!Array.isArray(details)) return recipes;
  const detailsById = new Map(details.map((recipe) => [String(recipe.id), recipe]));
  return recipes.map((summary) => {
    const detail = detailsById.get(String(summary.id));
    if (!detail) return summary;
    return {
      ...summary,
      title: recipeTitle(detail.title) || summary.title,
      image: typeof detail.image === 'string' ? detail.image : summary.image,
      subtitle: detail.readyInMinutes ? `${detail.readyInMinutes} мин.` : summary.subtitle,
      description: plainText(detail.summary) || summary.description,
      instructions: recipeSteps(detail),
      mealTypes: spoonacularMealTypes(detail.dishTypes),
    };
  });
}

async function refreshDishDetails(prisma, dish) {
  if (
    dish.detailsFetched ||
    dish.translationStatus === 'manual' ||
    !dish.externalId ||
    !['spoonacular', 'spoonacular-catalog'].includes(dish.source)
  )
    return false;
  const apiKey = spoonacularApiKey();
  if (!apiKey) return false;
  const [updated] = await fetchRecipeInformationBulk(apiKey, [{ id: dish.externalId }]);
  if (!updated?.title) return false;
  const instructions = JSON.stringify(updated.instructions ?? []);
  await prisma.dish.updateMany({
    where: { id: dish.id, translationStatus: { not: 'manual' }, updatedAt: dish.updatedAt },
    data: {
      title: updated.title,
      originalTitle: updated.title,
      description: updated.description || dish.description,
      originalDescription: updated.description || dish.description,
      instructions,
      originalInstructions: instructions,
      translationStatus: 'original',
      detailsFetched: true,
      subtitle: updated.subtitle || dish.subtitle,
      imageUrl: updated.image || dish.imageUrl,
      mealTypes: JSON.stringify(updated.mealTypes ?? []),
    },
  });
  return true;
}

function serializePopularRecipe(recipe) {
  const ingredients = Array.from(
    new Set(
      (Array.isArray(recipe.extendedIngredients) ? recipe.extendedIngredients : [])
        .map((item) => recipeTitle(item.name ?? item.originalName))
        .filter(Boolean),
    ),
  );
  return {
    id: String(recipe.id),
    title: recipeTitle(recipe.title),
    image: typeof recipe.image === 'string' ? recipe.image : null,
    source: 'spoonacular-catalog',
    subtitle: recipe.readyInMinutes ? `${recipe.readyInMinutes} мин.` : null,
    externalId: String(recipe.id),
    description: plainText(recipe.summary),
    instructions: recipeSteps(recipe),
    mealTypes: spoonacularMealTypes(recipe.dishTypes),
    usedIngredientCount: 0,
    missedIngredientCount: ingredients.length,
    expiringIngredientCount: 0,
    matchPercent: 0,
    usedIngredients: [],
    missedIngredients: ingredients,
  };
}

function yandexTranslateConfiguration() {
  return {
    apiKey: (process.env.YANDEX_TRANSLATE_API_KEY ?? '').trim(),
  };
}

function translationBatches(texts, maximumLength = 9_500) {
  const batches = [];
  let current = [];
  let currentLength = 0;
  for (const text of texts) {
    if (current.length > 0 && currentLength + text.length > maximumLength) {
      batches.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(text);
    currentLength += text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function translateTexts(prisma, texts, sourceLanguage = 'en', targetLanguage = 'ru') {
  const configuration = yandexTranslateConfiguration();
  const uniqueTexts = Array.from(
    new Set(
      texts
        .map((text) => plainText(text))
        .filter(
          (text) =>
            text && (targetLanguage === 'en' ? /[а-яё]/i.test(text) : !/[а-яё]/i.test(text)),
        ),
    ),
  );
  const translations = new Map();
  if (uniqueTexts.length === 0) return translations;

  const cached = await prisma.translationCache.findMany({
    where: {
      sourceLanguage,
      targetLanguage,
      sourceText: { in: uniqueTexts },
    },
  });
  for (const item of cached) translations.set(item.sourceText, item.translatedText);
  if (!configuration.apiKey) return translations;

  const missing = uniqueTexts.filter((text) => !translations.has(text));
  for (const batch of translationBatches(missing)) {
    const body = {
      sourceLanguageCode: sourceLanguage,
      targetLanguageCode: targetLanguage,
      format: 'PLAIN_TEXT',
      texts: batch,
      speller: true,
      // API keys belong to service accounts: Yandex selects their folder automatically.
    };
    const response = await fetch('https://translate.api.cloud.yandex.net/translate/v2/translate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Api-Key ${configuration.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const error = new Error('Yandex Translate request failed');
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    if (!Array.isArray(result?.translations) || result.translations.length !== batch.length) {
      throw new Error('Yandex Translate returned an invalid response');
    }
    const writes = [];
    for (let index = 0; index < batch.length; index++) {
      const sourceText = batch[index];
      const translatedText = plainText(result.translations[index]?.text);
      if (!translatedText) {
        throw new Error('Yandex Translate returned an empty translation');
      }
      translations.set(sourceText, translatedText);
      writes.push(
        prisma.translationCache.upsert({
          where: {
            sourceLanguage_targetLanguage_sourceText: {
              sourceLanguage,
              targetLanguage,
              sourceText,
            },
          },
          update: { translatedText },
          create: {
            sourceLanguage,
            targetLanguage,
            sourceText,
            translatedText,
          },
        }),
      );
    }
    await prisma.$transaction(writes);
  }
  return translations;
}

function needsRussianTranslation(value) {
  return /[a-z]/i.test(plainText(value)) && !/[а-яё]/i.test(plainText(value));
}

const catalogTranslationWork = new WeakMap();
function pendingCatalogTranslationWhere(ids) {
  return {
    householdId: null,
    source: { in: ['spoonacular', 'spoonacular-catalog'] },
    ...(ids ? { id: { in: ids } } : {}),
    OR: [
      { translationStatus: 'original' },
      { ingredients: { some: { product: { translationStatus: 'original' } } } },
    ],
  };
}

async function ensureCatalogLocalized(prisma, ids = null, logger = console) {
  // Ready pages must never wait for another reader's slow translation request.
  const candidates = await prisma.dish.findMany({
    where: pendingCatalogTranslationWhere(ids),
    select: {
      translationStatus: true,
      ingredients: {
        where: { product: { translationStatus: 'original' } },
        select: { product: { select: { name: true, originalName: true } } },
      },
    },
  });
  if (
    !candidates.some(
      (dish) =>
        dish.translationStatus === 'original' ||
        dish.ingredients.some(({ product }) =>
          needsRussianTranslation(product.originalName ?? product.name),
        ),
    )
  )
    return;
  const previous = catalogTranslationWork.get(prisma) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(() => persistCatalogTranslations(prisma, ids, logger));
  catalogTranslationWork.set(prisma, pending);
  return pending.finally(() => {
    if (catalogTranslationWork.get(prisma) === pending) catalogTranslationWork.delete(prisma);
  });
}

async function persistCatalogTranslations(prisma, ids, logger) {
  const dishes = await prisma.dish.findMany({
    where: pendingCatalogTranslationWhere(ids),
    include: { ingredients: { include: { product: true } } },
  });
  const pending = dishes.filter((dish) => dish.translationStatus === 'original');
  const products = [
    ...new Map(
      dishes.flatMap((dish) => dish.ingredients.map((item) => [item.product.id, item.product])),
    ).values(),
  ].filter(
    (product) =>
      product.translationStatus === 'original' &&
      needsRussianTranslation(product.originalName ?? product.name),
  );
  const texts = [
    ...pending.flatMap((dish) => [
      dish.originalTitle ?? dish.title,
      dish.originalDescription ?? dish.description,
      ...parseJsonArray(dish.originalInstructions ?? dish.instructions),
    ]),
    ...products.map((product) => product.originalName ?? product.name),
  ];
  let translations;
  try {
    translations = await translateTexts(prisma, texts);
  } catch (error) {
    logger.error('Recipe translation failed', error);
    return;
  }
  const translate = (text) => translations.get(plainText(text)) ?? text;
  const complete = (values) =>
    values.every((text) => !needsRussianTranslation(text) || translations.has(plainText(text)));
  const writes = [];
  for (const dish of pending) {
    const title = dish.originalTitle ?? dish.title;
    const description = dish.originalDescription ?? dish.description;
    const instructions = parseJsonArray(dish.originalInstructions ?? dish.instructions);
    if (!complete([title, description, ...instructions])) continue;
    // A manual edit made while Yandex was responding always wins.
    writes.push(
      prisma.dish.updateMany({
        where: { id: dish.id, translationStatus: 'original', updatedAt: dish.updatedAt },
        data: {
          originalTitle: title,
          originalDescription: description,
          originalInstructions: JSON.stringify(instructions),
          title: translate(title),
          description: translate(description),
          instructions: JSON.stringify(instructions.map(translate)),
          translationStatus: 'machine',
        },
      }),
    );
  }
  for (const product of products) {
    const original = product.originalName ?? product.name;
    if (!complete([original])) continue;
    const name = translate(original);
    writes.push(
      prisma.product.updateMany({
        where: { id: product.id, translationStatus: 'original', updatedAt: product.updatedAt },
        data: {
          name,
          originalName: original,
          translationStatus: 'machine',
          aliases: JSON.stringify([
            ...new Set([
              ...parseJsonArray(product.aliases),
              normalizeProductName(original),
              normalizeProductName(name),
            ]),
          ]),
        },
      }),
    );
  }
  if (writes.length) await prisma.$transaction(writes);
}

async function fetchPopularRecipeSuggestions(apiKey) {
  const cacheKey = '__popular-recipes__';
  const cached = recipeSuggestionsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.recipes;
  }

  const params = new URLSearchParams({
    apiKey,
    number: '8',
    addRecipeInformation: 'true',
    fillIngredients: 'true',
    instructionsRequired: 'true',
  });
  const response = await fetch(
    `https://api.spoonacular.com/recipes/complexSearch?${params.toString()}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    const error = new Error('Recipe catalog request failed');
    error.status = response.status === 402 || response.status === 429 ? 429 : 502;
    throw error;
  }

  const result = await response.json();
  const recipes = Array.isArray(result?.results) ? result.results.map(serializePopularRecipe) : [];
  recipeSuggestionsCache.set(cacheKey, {
    recipes,
    expiresAt: Date.now() + RECIPE_CACHE_TTL_MS,
  });
  return recipes;
}

const CATALOG_PAGE_SIZE = 20;

function catalogPageKey(query, offset) {
  return JSON.stringify([
    'catalog',
    query.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е'),
    offset,
  ]);
}

const catalogPageRequests = new WeakMap();
function fetchCatalogPage(prisma, query, offset) {
  let requests = catalogPageRequests.get(prisma);
  if (!requests) {
    requests = new Map();
    catalogPageRequests.set(prisma, requests);
  }
  const key = catalogPageKey(query, offset);
  if (requests.has(key)) return requests.get(key);
  const pending = loadCatalogPage(prisma, query, offset).finally(() => requests.delete(key));
  requests.set(key, pending);
  return pending;
}

async function loadCatalogPage(prisma, query, offset) {
  const pageKey = catalogPageKey(query, offset);
  const stored = await prisma.providerRecipePage.findUnique({ where: { id: pageKey } });
  if (stored)
    return {
      ids: parseJsonArray(stored.recipeIds),
      nextOffset: stored.nextOffset,
      limited: stored.limited,
    };
  const apiKey = spoonacularApiKey();
  if (!apiKey) throw Object.assign(new Error('Каталог временно недоступен.'), { status: 503 });
  let translatedQuery = query;
  if (/[а-яё]/i.test(query)) {
    const translations = await translateTexts(prisma, [query], 'ru', 'en');
    translatedQuery = translations.get(plainText(query));
    if (!translatedQuery) {
      throw Object.assign(new Error('Поиск временно недоступен. Попробуйте позже.'), {
        status: 503,
      });
    }
  }
  const params = new URLSearchParams({
    apiKey,
    query: translatedQuery,
    offset: String(offset),
    number: String(CATALOG_PAGE_SIZE),
    addRecipeInformation: 'true',
    fillIngredients: 'true',
    instructionsRequired: 'true',
    ...(query ? {} : { sort: 'popularity', sortDirection: 'desc' }),
  });
  const response = await fetch(`https://api.spoonacular.com/recipes/complexSearch?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error('Не удалось загрузить каталог. Попробуйте позже.'), {
      status: response.status === 402 || response.status === 429 ? 429 : 502,
    });
  }
  const result = await response.json();
  if (!Array.isArray(result?.results) || !Number.isFinite(result.totalResults)) {
    throw Object.assign(new Error('Каталог вернул некорректный ответ.'), { status: 502 });
  }
  const next = offset + result.results.length;
  const page = {
    recipes: result.results.map(serializePopularRecipe),
    nextOffset: result.results.length && next < result.totalResults && next <= 900 ? next : null,
    limited: next > 900 && next < result.totalResults,
  };
  await saveSpoonacularSuggestions(prisma, page.recipes);
  const ids = page.recipes.map((recipe) => `spoonacular-${recipe.externalId}`);
  await prisma.providerRecipePage.upsert({
    where: { id: pageKey },
    update: {},
    create: {
      id: pageKey,
      recipeIds: JSON.stringify(ids),
      nextOffset: page.nextOffset,
      limited: page.limited,
    },
  });
  return { ids, nextOffset: page.nextOffset, limited: page.limited };
}

async function recipeCatalogPage(prisma, householdId, input, logger) {
  const { query, offset, source } = input;
  let warning = '';
  if (source === 'auto' && query) {
    const saved = await savedRecipeCatalogPage(prisma, householdId, input, logger);
    if (saved.recipes.length) return saved;
  }
  if (source !== 'local') {
    try {
      const page = await fetchCatalogPage(prisma, query, offset);
      const ids = page.ids;
      const local = await matchedDishSuggestions(prisma, householdId, 'catalog', logger, ids);
      const byId = new Map(local.recipes.map((recipe) => [recipe.id, recipe]));
      return {
        recipes: ids.map((id) => byId.get(id)).filter(Boolean),
        nextOffset: page.nextOffset,
        source: 'remote',
        limited: page.limited,
      };
    } catch (error) {
      logger.error('Recipe catalog page failed', error);
      // Never switch pagination sources halfway through a feed: retry the same page.
      if (offset > 0 || source === 'remote') throw error;
      warning = 'Общий каталог временно недоступен. Показаны рецепты из сохранённой базы.';
    }
  }
  return savedRecipeCatalogPage(prisma, householdId, input, logger, warning);
}

async function savedRecipeCatalogPage(prisma, householdId, input, logger, warning = '') {
  const { query, offset } = input;
  if (!query.trim()) {
    const page = await prisma.dish.findMany({
      where: { householdId: null, source: { not: 'user' } },
      select: { id: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: CATALOG_PAGE_SIZE + 1,
    });
    const ids = page.slice(0, CATALOG_PAGE_SIZE).map((dish) => dish.id);
    const local = await matchedDishSuggestions(prisma, householdId, 'catalog', logger, ids);
    const byId = new Map(local.recipes.map((recipe) => [recipe.id, recipe]));
    return {
      recipes: ids.map((id) => byId.get(id)).filter(Boolean),
      source: 'local',
      nextOffset: page.length > CATALOG_PAGE_SIZE ? offset + CATALOG_PAGE_SIZE : null,
      limited: false,
      ...(warning ? { warning } : {}),
    };
  }
  const normalize = (text) => text.toLocaleLowerCase('ru').replace(/ё/g, 'е');
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const saved = await prisma.dish.findMany({
    where: { householdId: null, source: { not: 'user' } },
    select: {
      id: true,
      title: true,
      originalTitle: true,
      ingredients: { select: { product: { select: { name: true, originalName: true } } } },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
  });
  // Include cached Russian titles/ingredients in search without translating the whole database.
  const texts = saved.flatMap((dish) => [
    dish.title,
    ...dish.ingredients.map((item) => item.product.name),
  ]);
  const cached = texts.length
    ? await prisma.translationCache.findMany({
        where: { sourceLanguage: 'en', targetLanguage: 'ru', sourceText: { in: texts } },
      })
    : [];
  const translations = new Map(cached.map((item) => [item.sourceText, item.translatedText]));
  const matching = saved.filter((dish) => {
    const values = [
      dish.title,
      dish.originalTitle ?? '',
      ...dish.ingredients.flatMap((item) => [item.product.name, item.product.originalName ?? '']),
    ];
    const text = normalize(
      values.flatMap((value) => [value, translations.get(value) ?? '']).join(' '),
    );
    return terms.every((term) => text.includes(term));
  });
  const ids = matching.slice(offset, offset + CATALOG_PAGE_SIZE).map((dish) => dish.id);
  const local = await matchedDishSuggestions(prisma, householdId, 'catalog', logger, ids);
  const byId = new Map(local.recipes.map((recipe) => [recipe.id, recipe]));
  return {
    recipes: ids.map((id) => byId.get(id)).filter(Boolean),
    source: 'local',
    nextOffset: offset + CATALOG_PAGE_SIZE < matching.length ? offset + CATALOG_PAGE_SIZE : null,
    limited: false,
    ...(warning ? { warning } : {}),
  };
}

async function importRecipeSuggestions(prisma, ingredients) {
  const key = JSON.stringify([
    'suggestions',
    [...new Set(ingredients.map(canonicalIngredientName))].sort(),
  ]);
  if (await prisma.providerRecipePage.findUnique({ where: { id: key } })) return;
  const recipes = await fetchRecipeSuggestions(ingredients);
  await saveSpoonacularSuggestions(prisma, recipes);
  await prisma.providerRecipePage.upsert({
    where: { id: key },
    update: {},
    create: {
      id: key,
      recipeIds: JSON.stringify(
        recipes.map((recipe) => `spoonacular-${recipe.externalId ?? recipe.id}`),
      ),
    },
  });
}

async function fetchRecipeSuggestions(ingredients) {
  const apiKey = spoonacularApiKey();
  if (!apiKey) {
    const error = new Error('Recipe API is not configured');
    error.status = 503;
    throw error;
  }

  const apiIngredients = Array.from(
    new Set(ingredients.map(spoonacularIngredientName).filter(Boolean)),
  );
  if (!apiIngredients.length) {
    return fetchPopularRecipeSuggestions(apiKey);
  }

  const cacheKey = apiIngredients
    .map((ingredient) => ingredient.toLowerCase())
    .sort()
    .join('|');
  const cached = recipeSuggestionsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.recipes;
  }

  const params = new URLSearchParams({
    apiKey,
    ingredients: apiIngredients.join(','),
    number: '5',
    ranking: '1',
    ignorePantry: 'true',
  });
  const response = await fetch(
    `https://api.spoonacular.com/recipes/findByIngredients?${params.toString()}`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) {
    const error = new Error('Recipe API request failed');
    error.status = response.status === 402 || response.status === 429 ? 429 : 502;
    throw error;
  }

  const recipes = await response.json();
  let suggestions = Array.isArray(recipes) ? recipes.map(serializeRecipeSuggestion) : [];
  if (!suggestions.length) {
    return fetchPopularRecipeSuggestions(apiKey);
  }
  try {
    suggestions = await fetchRecipeInformationBulk(apiKey, suggestions);
  } catch {
    // The ingredient match remains useful if the optional details request is unavailable.
  }
  recipeSuggestionsCache.set(cacheKey, {
    recipes: suggestions,
    expiresAt: Date.now() + RECIPE_CACHE_TTL_MS,
  });
  return suggestions;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function productMatchesFridge(product, fridgeNames) {
  const names = [product.normalizedName, ...parseJsonArray(product.aliases)];
  return names.some(
    (name) =>
      fridgeNames.has(normalizeProductName(name)) || fridgeNames.has(canonicalIngredientName(name)),
  );
}

function productMatchesFridgeItem(product, item) {
  return productMatchesFridge(
    product,
    new Set([normalizeProductName(item.name), canonicalIngredientName(item.name)]),
  );
}

function fridgeItemIsExpiring(item, now = new Date()) {
  if (!item.expiresAt) return false;
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(item.expiresAt);
  expiry.setUTCHours(0, 0, 0, 0);
  return expiry.getTime() - today.getTime() <= (item.reminderDays ?? 0) * 86_400_000;
}

function formatIngredient(product, ingredient) {
  const amount =
    ingredient.quantity && ingredient.unit
      ? `${ingredient.quantity} ${ingredient.unit}`
      : ingredient.quantity
        ? String(ingredient.quantity)
        : '';
  return amount ? `${product.name} ${amount}` : product.name;
}

function serializeLocalDishSuggestion(dish, ingredients) {
  const requiredIngredients = ingredients.filter((ingredient) => ingredient.required);
  const usedIngredients = requiredIngredients.filter((ingredient) => ingredient.available);
  const missedIngredients = requiredIngredients.filter((ingredient) => !ingredient.available);
  const expiringIngredientCount = usedIngredients.filter(
    (ingredient) => ingredient.expiring,
  ).length;
  const total = Math.max(requiredIngredients.length, 1);
  const matchPercent = Math.round((usedIngredients.length / total) * 100);
  return {
    id: dish.id,
    title: dish.title,
    image: dish.imageUrl ?? null,
    source: dish.source ?? 'catalog',
    externalId: dish.externalId ?? null,
    subtitle: dish.subtitle,
    description: dish.description,
    instructions: parseJsonArray(dish.instructions),
    mealTypes: parseJsonArray(dish.mealTypes),
    ingredients: requiredIngredients.map((ingredient) => ingredient.product.name),
    preparationMinutes: /^\d+ мин/.test(dish.subtitle ?? '')
      ? Number.parseInt(dish.subtitle, 10)
      : null,
    usedIngredientCount: usedIngredients.length,
    missedIngredientCount: missedIngredients.length,
    expiringIngredientCount,
    matchPercent,
    usedIngredients: usedIngredients.map((ingredient) =>
      formatIngredient(ingredient.product, ingredient),
    ),
    missedIngredients: missedIngredients.map((ingredient) =>
      formatIngredient(ingredient.product, ingredient),
    ),
  };
}

function serializeDevRecipe(dish) {
  return {
    mealTypes: parseJsonArray(dish.mealTypes),
    id: dish.id,
    externalId: dish.externalId,
    title: dish.title,
    source: dish.source,
    image: dish.imageUrl,
    createdAt: dish.createdAt.toISOString(),
    updatedAt: dish.updatedAt.toISOString(),
    ingredients: dish.ingredients.map((ingredient) => ingredient.product.name),
    description: dish.description ?? '',
    instructions: parseJsonArray(dish.instructions),
    originalTitle: dish.originalTitle,
    originalDescription: dish.originalDescription,
    originalInstructions: parseJsonArray(dish.originalInstructions),
    translationStatus: dish.translationStatus,
    savedInDatabase: true,
    products: dish.ingredients.map((ingredient) => serializeDevProduct(ingredient.product)),
  };
}

function serializeDevProduct(product) {
  return {
    id: product.id,
    name: product.name,
    originalName: product.originalName,
    translationStatus: product.translationStatus,
    savedInDatabase: true,
    updatedAt: product.updatedAt.toISOString(),
  };
}

async function saveSpoonacularSuggestions(prisma, recipes) {
  for (const recipe of recipes) {
    const externalId = String(recipe.externalId ?? recipe.id);
    const dishId = `spoonacular-${externalId}`;
    await prisma.$transaction(
      async (transaction) => {
        // Stored content is authoritative, including machine and manual translations.
        const stored = await transaction.dish.findUnique({
          where: { id: dishId },
          select: { id: true, mealTypes: true },
        });
        if (stored) {
          if (stored.mealTypes === '[]' && recipe.mealTypes?.length) {
            await transaction.dish.updateMany({
              where: { id: dishId, mealTypes: '[]', translationStatus: { not: 'manual' } },
              data: { mealTypes: JSON.stringify(recipe.mealTypes) },
            });
          }
          return;
        }
        const description = recipe.description || 'Рецепт из общей базы.';
        const instructions = JSON.stringify(recipe.instructions ?? []);
        await transaction.dish.create({
          data: {
            id: dishId,
            title: recipe.title,
            originalTitle: recipe.title,
            subtitle: recipe.subtitle || 'Spoonacular',
            description,
            originalDescription: description,
            instructions,
            originalInstructions: instructions,
            detailsFetched: Array.isArray(recipe.instructions),
            mealTypes: JSON.stringify(recipe.mealTypes ?? []),
            imageUrl: recipe.image,
            source: recipe.source === 'spoonacular-catalog' ? recipe.source : 'spoonacular',
            externalId,
          },
        });
        const names = [
          ...new Set(
            [...recipe.usedIngredients, ...recipe.missedIngredients]
              .map((name) => name.trim())
              .filter(Boolean),
          ),
        ];
        for (const ingredientName of names) {
          const normalizedName = normalizeProductName(ingredientName);
          let product = await transaction.product.findUnique({ where: { normalizedName } });
          if (!product) {
            const cached = await transaction.translationCache.findUnique({
              where: {
                sourceLanguage_targetLanguage_sourceText: {
                  sourceLanguage: 'en',
                  targetLanguage: 'ru',
                  sourceText: ingredientName,
                },
              },
            });
            if (cached)
              product = await transaction.product.findUnique({
                where: { normalizedName: normalizeProductName(cached.translatedText) },
              });
          }
          if (!product)
            product = await transaction.product.create({
              data: {
                name: ingredientName,
                originalName: ingredientName,
                normalizedName,
                aliases: '[]',
              },
            });
          else if (!parseJsonArray(product.aliases).includes(normalizedName)) {
            await transaction.product.update({
              where: { id: product.id },
              data: {
                aliases: JSON.stringify([...parseJsonArray(product.aliases), normalizedName]),
              },
            });
          }
          await transaction.dishIngredient.upsert({
            where: { dishId_productId: { dishId, productId: product.id } },
            update: {},
            create: { dishId, productId: product.id },
          });
        }
      },
      { timeout: 20_000 },
    );
  }
}

async function matchedDishSuggestions(
  prisma,
  householdId,
  scope = 'catalog',
  logger = console,
  ids = null,
  localize = true,
) {
  if (ids?.length === 0) return { recipes: [], ingredients: [], hasLocalCatalog: false };
  if (scope === 'catalog' && localize) await ensureCatalogLocalized(prisma, ids, logger);
  const whereClause =
    scope === 'user'
      ? `WHERE d.source = 'user' AND d."householdId" = ?`
      : `WHERE d.source != 'user' AND d."householdId" IS NULL`;
  const [fridgeItems, dishCount, rows] = await Promise.all([
    prisma.fridgeItem.findMany({
      where: { householdId, category: 'products' },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
    }),
    scope === 'user'
      ? prisma.dish.count({ where: { source: 'user', householdId } })
      : prisma.dish.count({ where: { source: { not: 'user' }, householdId: null } }),
    prisma.$queryRawUnsafe(
      `
      SELECT
        d.id AS dishId,
        d.source AS dishSource,
        d."externalId" AS dishExternalId,
        d.title AS dishTitle,
        d.subtitle AS dishSubtitle,
        d.description AS dishDescription,
        d.instructions AS dishInstructions,
        d."mealTypes" AS dishMealTypes,
        d."imageUrl" AS dishImageUrl,
        di.quantity AS quantity,
        di.unit AS unit,
        di.required AS required,
        p.id AS productId,
        p.name AS productName,
        p."normalizedName" AS productNormalizedName,
        p.aliases AS productAliases
      FROM "Dish" d
      LEFT JOIN "DishIngredient" di ON di."dishId" = d.id
      LEFT JOIN "Product" p ON p.id = di."productId"
      ${whereClause}
      ${ids ? `AND d.id IN (${ids.map(() => '?').join(',')})` : ''}
      ORDER BY d.title ASC, p.name ASC
    `,
      ...(scope === 'user' ? [householdId] : []),
      ...(ids ?? []),
    ),
  ]);
  const fridgeIngredients = Array.from(
    new Set(fridgeItems.map((item) => normalizeProductName(item.name))),
  );
  const fridgeNames = new Set(
    fridgeItems.flatMap((item) => [
      normalizeProductName(item.name),
      canonicalIngredientName(item.name),
    ]),
  );
  const dishes = new Map();
  for (const row of rows) {
    const dish = dishes.get(row.dishId) ?? {
      dish: {
        id: row.dishId,
        source: row.dishSource,
        externalId: row.dishExternalId,
        title: row.dishTitle,
        subtitle: row.dishSubtitle,
        description: row.dishDescription,
        instructions: row.dishInstructions,
        mealTypes: row.dishMealTypes,
        imageUrl: row.dishImageUrl,
      },
      ingredients: [],
    };
    if (!row.productId) {
      dishes.set(row.dishId, dish);
      continue;
    }
    const product = {
      id: row.productId,
      name: row.productName,
      normalizedName: row.productNormalizedName,
      aliases: row.productAliases,
    };
    dish.ingredients.push({
      product,
      quantity: row.quantity,
      unit: row.unit,
      required: Boolean(row.required),
      available: productMatchesFridge(product, fridgeNames),
      expiring: fridgeItems.some(
        (item) => productMatchesFridgeItem(product, item) && fridgeItemIsExpiring(item),
      ),
    });
    dishes.set(row.dishId, dish);
  }
  const recipes = Array.from(dishes.values())
    .map(({ dish, ingredients }) => serializeLocalDishSuggestion(dish, ingredients))
    .sort(
      (left, right) =>
        right.expiringIngredientCount - left.expiringIngredientCount ||
        right.matchPercent - left.matchPercent ||
        left.missedIngredientCount - right.missedIngredientCount ||
        left.title.localeCompare(right.title),
    );
  return {
    // Saved recipes must also be localized after enabling Translate or recovering from an outage.
    recipes,
    ingredients: fridgeIngredients,
    hasLocalCatalog: dishCount > 0,
  };
}

async function saveUserRecipe(prisma, user, input, id) {
  return prisma.$transaction(async (transaction) => {
    const existing = id
      ? await transaction.dish.findFirst({
          where: { id, householdId: user.householdId, source: 'user' },
          include: { ingredients: true },
        })
      : null;
    if (id && !existing) {
      const error = new Error('Рецепт не найден');
      error.status = 404;
      throw error;
    }
    const names = [
      ...new Map(
        input.ingredients.map((ingredient) => [normalizeProductName(ingredient), ingredient]),
      ).values(),
    ];
    const data = {
      householdId: user.householdId,
      title: input.title,
      mealTypes:
        input.mealTypes === undefined
          ? (existing?.mealTypes ?? '[]')
          : JSON.stringify(input.mealTypes),
      subtitle:
        input.preparationMinutes === undefined && existing
          ? existing.subtitle
          : input.preparationMinutes
            ? `${input.preparationMinutes} мин.`
            : `${names.length} ингредиент${ingredientEnding(names.length)}`,
      description: input.description ?? existing?.description ?? '',
      imageUrl: input.imageUrl === undefined ? (existing?.imageUrl ?? null) : input.imageUrl,
      instructions: JSON.stringify(
        input.instructions ??
          (existing?.instructions
            ? parseJsonArray(existing.instructions)
            : ['Подготовьте ингредиенты.', 'Приготовьте блюдо привычным способом.']),
      ),
      source: 'user',
    };
    const dish = existing
      ? await transaction.dish.update({ where: { id: existing.id }, data })
      : await transaction.dish.create({ data });
    if (existing) await transaction.dishIngredient.deleteMany({ where: { dishId: dish.id } });

    for (const ingredient of names) {
      const normalizedName = normalizeProductName(ingredient);
      const product = await transaction.product.upsert({
        where: { normalizedName },
        update: {},
        create: {
          name: ingredient,
          normalizedName,
          aliases: JSON.stringify([]),
        },
      });
      await transaction.dishIngredient.create({
        data: {
          dishId: dish.id,
          productId: product.id,
          quantity:
            existing?.ingredients.find((item) => item.productId === product.id)?.quantity ?? null,
          unit: existing?.ingredients.find((item) => item.productId === product.id)?.unit ?? null,
        },
      });
    }

    return dish;
  });
}

async function addMissingDishIngredientsToShopping(prisma, user, dishId) {
  await ensureCatalogLocalized(prisma, [dishId]);
  return prisma.$transaction(async (transaction) => {
    const dish = await transaction.dish.findFirst({
      where: {
        id: dishId,
        OR: [{ householdId: null }, { householdId: user.householdId }],
      },
      include: { ingredients: { include: { product: true } } },
    });
    if (!dish) {
      const error = new Error('Рецепт не найден');
      error.status = 404;
      throw error;
    }

    const [fridgeItems, shoppingItems] = await Promise.all([
      transaction.fridgeItem.findMany({
        where: { householdId: user.householdId, category: 'products' },
      }),
      transaction.shoppingItem.findMany({ where: { householdId: user.householdId } }),
    ]);
    const shoppingNames = new Set(
      shoppingItems.flatMap((item) => [
        normalizeProductName(item.name),
        canonicalIngredientName(item.name),
      ]),
    );
    const created = [];
    let skippedCount = 0;

    for (const ingredient of dish.ingredients.filter((item) => item.required)) {
      if (fridgeItems.some((item) => productMatchesFridgeItem(ingredient.product, item))) {
        continue;
      }
      if (productMatchesFridge(ingredient.product, shoppingNames)) {
        skippedCount += 1;
        continue;
      }

      const item = await transaction.shoppingItem.create({
        data: {
          householdId: user.householdId,
          name: ingredient.product.name,
          quantity: ingredient.quantity ?? 1,
          unit: ingredient.unit ?? 'шт.',
          category: 'products',
        },
      });
      created.push(item);
      shoppingNames.add(ingredient.product.normalizedName);
      shoppingNames.add(canonicalIngredientName(ingredient.product.name));
    }

    return { items: created, addedCount: created.length, skippedCount };
  });
}

function ingredientEnding(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return '';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'а';
  }
  return 'ов';
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function emptyDailyBuckets(days = 7) {
  const buckets = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    buckets.push({
      date: dayKey(date),
      users: 0,
      sessions: 0,
      fridgeItems: 0,
      shoppingItems: 0,
      supportTickets: 0,
      feedback: 0,
    });
  }
  return buckets;
}

async function dailyCounts(prisma, table, since) {
  // Table names are internal constants; dates are bound parameters.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT date(CASE WHEN typeof("createdAt") = 'integer'
       THEN "createdAt" / 1000 ELSE "createdAt" END,
       CASE WHEN typeof("createdAt") = 'integer' THEN 'unixepoch' ELSE '+0 days' END) AS date,
       COUNT(*) AS total FROM "${table}" WHERE "createdAt" >= ? GROUP BY date`,
    since,
  );
  return rows.map((row) => ({ date: row.date, total: Number(row.total) }));
}

const unansweredTicketCondition = `t.status = 'open'
  AND COALESCE((SELECT m."authorRole" FROM "SupportMessage" m
    WHERE m."ticketId" = t.id ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1), 'user') != 'support'`;

async function unansweredTicketCount(prisma) {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS total FROM "SupportTicket" t WHERE ${unansweredTicketCondition}`,
  );
  return Number(row.total);
}

async function getHousehold(prisma, householdId) {
  let household = await prisma.household.findUnique({
    where: { id: householdId },
    include: { users: { orderBy: [{ displayName: 'asc' }, { email: 'asc' }] } },
  });
  if (!household) {
    const error = new Error('Group not found');
    error.status = 404;
    throw error;
  }

  return household;
}

function householdHasPlus(household) {
  const periodActive =
    !household.subscriptionPeriodEnd || household.subscriptionPeriodEnd.getTime() > Date.now();
  return (
    household.plan === 'plus' &&
    ['active', 'trialing'].includes(household.subscriptionStatus) &&
    periodActive
  );
}

async function requireHouseholdPlus(prisma, householdId) {
  const household = await getHousehold(prisma, householdId);
  if (householdHasPlus(household)) return;

  const error = new Error('Функция доступна в Homie Plus');
  error.status = 403;
  throw error;
}

async function mergeHouseholdInto(transaction, sourceHouseholdId, targetHouseholdId) {
  if (sourceHouseholdId === targetHouseholdId) {
    return;
  }

  if ((await transaction.user.count({ where: { householdId: sourceHouseholdId } })) > 1) {
    const error = new Error('Нельзя перенести общий дом без согласия остальных участников');
    error.status = 409;
    throw error;
  }

  await transaction.fridgeItem.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.shoppingItem.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.user.updateMany({
    where: { householdId: sourceHouseholdId },
    data: { householdId: targetHouseholdId },
  });
  await transaction.household.deleteMany({
    where: { id: sourceHouseholdId, users: { none: {} } },
  });
}

async function createNotification(prisma, { userId, type, title, body, data, dedupeKey }) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
        dedupeKey,
      },
    });
  } catch (error) {
    if (error?.code === 'P2002' && dedupeKey) {
      return null;
    }
    throw error;
  }
}

function pushConfiguration() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT ?? 'mailto:support@eat-it.space',
    configured: Boolean(publicKey && privateKey),
  };
}

function isQuietHours(user, now = new Date()) {
  if (!user.quietHoursStart || !user.quietHoursEnd) return false;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: user.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
    const current = hour * 60 + minute;
    const toMinutes = (value) => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const start = toMinutes(user.quietHoursStart);
    const end = toMinutes(user.quietHoursEnd);
    return start <= end ? current >= start && current < end : current >= start || current < end;
  } catch {
    return false;
  }
}

async function sendPushNotification(prisma, userId, notification, logger = console) {
  const configuration = pushConfiguration();
  if (!configuration.configured) {
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || isQuietHours(user)) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    tag: notification.dedupeKey ?? notification.id,
    data: {
      url: '/',
      notificationId: notification.id,
      ...(notification.data ? JSON.parse(notification.data) : {}),
    },
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      // Recheck stored subscriptions too: older records may contain arbitrary URLs.
      if (!isTrustedPushEndpoint(subscription.endpoint)) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
          {
            TTL: 60 * 60 * 24,
            timeout: 5_000,
            urgency: notification.type === 'expiry' ? 'normal' : 'high',
            vapidDetails: {
              subject: configuration.subject,
              publicKey: configuration.publicKey,
              privateKey: configuration.privateKey,
            },
          },
        );
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
          return;
        }
        logger.error('Push delivery failed', error);
      }
    }),
  );
}

async function createAndSendNotification(prisma, input, logger = console) {
  const notification = await createNotification(prisma, input);
  if (notification) {
    await sendPushNotification(prisma, input.userId, notification, logger);
  }
  return notification;
}

async function notifyHouseholdShoppingChange(prisma, user, item, action, logger = console) {
  const members = await prisma.user.findMany({
    where: { householdId: user.householdId, id: { not: user.id } },
    select: { id: true, notifyShopping: true },
  });
  const added = action === 'added';
  await Promise.all(
    members.map((member) =>
      member.notifyShopping
        ? createAndSendNotification(
            prisma,
            {
              userId: member.id,
              type: added ? 'shopping_added' : 'shopping_removed',
              title: added ? 'Добавили в покупки' : 'Убрали из покупок',
              body: `${user.displayName} ${added ? 'добавил(а)' : 'убрал(а)'} «${item.name}» ${added ? 'в список покупок' : 'из списка покупок'}.`,
              data: { shoppingItemId: item.id, action },
              dedupeKey: `shopping:${action}:${item.id}`,
            },
            logger,
          )
        : Promise.resolve(null),
    ),
  );
}

async function ensureExpiryNotifications(prisma, user, logger = console) {
  if (!user.notifyExpiry) return;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const items = await prisma.fridgeItem.findMany({
    where: { householdId: user.householdId, expiresAt: { not: null } },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
  });

  await Promise.all(
    items.map(async (item) => {
      const expires = new Date(item.expiresAt);
      expires.setUTCHours(0, 0, 0, 0);
      const days = Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
      if (days > item.reminderDays) {
        return;
      }

      let body = `${item.name}: срок уже истек.`;
      if (days === 0) {
        body = `${item.name}: срок истекает сегодня.`;
      } else if (days > 0) {
        body = `${item.name}: срок истекает через ${days} дн.`;
      }

      await createAndSendNotification(
        prisma,
        {
          userId: user.id,
          type: 'expiry',
          title: 'Срок годности',
          body,
          data: { fridgeItemId: item.id, expiresAt: item.expiresAt.toISOString().slice(0, 10) },
          dedupeKey: `expiry:${item.id}:${today.toISOString().slice(0, 10)}`,
        },
        logger,
      );
    }),
  );
}

export async function dispatchExpiryNotifications(prisma, logger = console) {
  const users = await prisma.user.findMany();
  for (const user of users) {
    await ensureExpiryNotifications(prisma, user, logger);
  }
}

function routeMatch(pathname, pattern) {
  const match = pathname.match(pattern);
  return match?.groups ?? null;
}

function isSecureRequest(request) {
  return request.headers['x-forwarded-proto'] === 'https';
}

const DEFAULT_ADMIN_EMAILS = ['vladfinder@yandex.ru', 'krisyagodka@gmail.com'];

function adminEmails() {
  return new Set(
    [DEFAULT_ADMIN_EMAILS.join(','), process.env.ADMIN_EMAILS ?? '']
      .join(',')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdmin(user) {
  const trustedIds = new Set(
    (process.env.ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return (
    trustedIds.has(user.id) ||
    (['google', 'apple'].includes(user.authProvider) && adminEmails().has(user.email.toLowerCase()))
  );
}

function requireAdmin(user) {
  if (isAdmin(user)) {
    return;
  }
  const error = new Error('Admin access required');
  error.status = 403;
  throw error;
}

function authResponse(response, status, user, session, request) {
  json(
    response,
    status,
    {
      user: { ...serializeUser(user), isAdmin: isAdmin(user) },
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
    },
    { 'Set-Cookie': sessionCookie(session.token, session.expiresAt, isSecureRequest(request)) },
  );
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...(cookies.length > 0 ? { 'Set-Cookie': cookies } : {}),
  });
  response.end();
}

function appLocation(searchParams = {}) {
  const location = new URL(process.env.APP_URL ?? 'https://homie-web.app');
  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      location.searchParams.set(key, value);
    }
  }
  return location.toString();
}

async function createHouseholdForUser(transaction, displayName) {
  const userCount = await transaction.user.count();
  if (userCount === 0) {
    const legacy = await transaction.household.findUnique({
      where: { id: 'legacy-household' },
    });
    if (legacy) {
      return legacy;
    }
  }
  return transaction.household.create({ data: { name: `${displayName}: дом` } });
}

export async function findOrCreateOAuthUser(prisma, provider, profile) {
  if (!profile.subject || !profile.email || !profile.emailVerified) {
    throw new Error('OAuth provider did not return a verified email');
  }

  const identity = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider, subject: profile.subject } },
    include: { user: true },
  });
  if (identity) {
    return identity.user;
  }

  return prisma.$transaction(async (transaction) => {
    let user = await transaction.user.findUnique({
      where: { email: profile.email.toLowerCase() },
    });
    if (!user) {
      const household = await createHouseholdForUser(transaction, profile.displayName);
      user = await transaction.user.create({
        data: {
          householdId: household.id,
          email: profile.email.toLowerCase(),
          displayName: profile.displayName,
          authProvider: provider,
          providerSubject: profile.subject,
        },
      });
    } else if (user.authProvider === 'password') {
      // Password registration does not verify email ownership. A previous registrant
      // must not retain access after the email owner signs in through a verified provider.
      await transaction.session.deleteMany({ where: { userId: user.id } });
      user = await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash: null, authProvider: provider, providerSubject: profile.subject },
      });
    }
    await transaction.authIdentity.create({
      data: { userId: user.id, provider, subject: profile.subject },
    });
    return user;
  });
}

async function findFridgeItem(prisma, id, householdId) {
  const item = await prisma.fridgeItem.findFirst({ where: { id, householdId } });
  if (!item) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }
  return item;
}

async function findShoppingItem(prisma, id, householdId) {
  const item = await prisma.shoppingItem.findFirst({ where: { id, householdId } });
  if (!item) {
    const error = new Error('Item not found');
    error.status = 404;
    throw error;
  }
  return item;
}

export function createApiServer(prisma, logger = console) {
  const limitAuth = createAuthLimiter();
  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    let url;

    try {
      url = new URL(request.url ?? '/', 'http://localhost');
      const isCapacitorRequest = applyCapacitorCors(request, response);
      if (method === 'OPTIONS' && url.pathname.startsWith('/api/') && isCapacitorRequest) {
        response.writeHead(204);
        response.end();
        return;
      }

      if (
        ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) &&
        url.pathname !== '/api/auth/apple/callback' &&
        !isAllowedWriteOrigin(request, CAPACITOR_ORIGINS)
      ) {
        json(response, 403, { error: 'Недопустимый источник запроса' });
        return;
      }

      if (method === 'POST' && ['/api/auth/login', '/api/auth/register'].includes(url.pathname)) {
        const retryAfter = limitAuth(`ip:${clientAddress(request)}`, 120);
        if (retryAfter) {
          json(
            response,
            429,
            { error: 'Слишком много попыток. Попробуйте позже.' },
            { 'Retry-After': String(retryAfter) },
          );
          return;
        }
      }

      if (method === 'GET' && url.pathname === '/api/health') {
        json(response, 200, { status: 'ok' });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/providers') {
        json(response, 200, {
          password: true,
          google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          apple: Boolean(
            process.env.APPLE_CLIENT_ID &&
            process.env.APPLE_TEAM_ID &&
            process.env.APPLE_KEY_ID &&
            process.env.APPLE_PRIVATE_KEY,
          ),
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/register') {
        const input = registerSchema.parse(await readJson(request));
        const existing = await prisma.user.findUnique({ where: { email: input.email } });
        if (existing) {
          json(response, 409, { error: 'Аккаунт с таким email уже существует' });
          return;
        }

        const passwordHash = await hashPassword(input.password);
        const user = await prisma.$transaction(async (transaction) => {
          const household = await createHouseholdForUser(transaction, input.displayName);

          return transaction.user.create({
            data: {
              householdId: household.id,
              email: input.email,
              displayName: input.displayName,
              passwordHash,
            },
          });
        });
        const session = await createSession(prisma, user.id);
        authResponse(response, 201, user, session, request);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const input = loginSchema.parse(await readJson(request));
        const retryAfter = limitAuth(`email:${input.email}`, 10);
        if (retryAfter) {
          json(
            response,
            429,
            { error: 'Слишком много попыток. Попробуйте позже.' },
            { 'Retry-After': String(retryAfter) },
          );
          return;
        }
        const user = await prisma.user.findUnique({ where: { email: input.email } });
        if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
          json(response, 401, { error: 'Неверный email или пароль' });
          return;
        }
        const session = await createSession(prisma, user.id);
        authResponse(response, 200, user, session, request);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/google') {
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
          json(response, 503, { error: 'Google OAuth is not configured' });
          return;
        }
        const authorization = googleAuthorization();
        redirect(response, authorization.url, [
          oauthCookie('eat_it_google_state', authorization.state, isSecureRequest(request)),
          oauthCookie('eat_it_google_verifier', authorization.verifier, isSecureRequest(request)),
        ]);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/google/callback') {
        const clearCookies = [
          clearOauthCookie('eat_it_google_state', isSecureRequest(request)),
          clearOauthCookie('eat_it_google_verifier', isSecureRequest(request)),
        ];
        if (url.searchParams.get('error')) {
          redirect(response, appLocation({ auth_error: 'google_cancelled' }), clearCookies);
          return;
        }

        const state = cookieValue(request, 'eat_it_google_state');
        const verifier = cookieValue(request, 'eat_it_google_verifier');
        const code = url.searchParams.get('code');
        if (!state || state !== url.searchParams.get('state') || !verifier || !code) {
          redirect(response, appLocation({ auth_error: 'google_failed' }), clearCookies);
          return;
        }
        try {
          const profile = await exchangeGoogleCode(code, verifier);
          const user = await findOrCreateOAuthUser(prisma, 'google', profile);
          const session = await createSession(prisma, user.id);
          redirect(response, appLocation(), [
            sessionCookie(session.token, session.expiresAt, isSecureRequest(request)),
            ...clearCookies,
          ]);
        } catch (error) {
          logger.error(`${method} ${url.pathname}`, error);
          redirect(response, appLocation({ auth_error: 'google_failed' }), clearCookies);
        }
        return;
      }

      if (method === 'GET' && url.pathname === '/api/auth/apple') {
        if (
          !process.env.APPLE_CLIENT_ID ||
          !process.env.APPLE_TEAM_ID ||
          !process.env.APPLE_KEY_ID ||
          !process.env.APPLE_PRIVATE_KEY
        ) {
          json(response, 503, { error: 'Apple OAuth is not configured' });
          return;
        }
        const authorization = appleAuthorization();
        redirect(response, authorization.url, [
          oauthCookie('eat_it_apple_state', authorization.state, true, 'None'),
          oauthCookie('eat_it_apple_nonce', authorization.nonce, true, 'None'),
        ]);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/apple/callback') {
        const form = await readForm(request);
        const clearCookies = [
          clearOauthCookie('eat_it_apple_state', true, 'None'),
          clearOauthCookie('eat_it_apple_nonce', true, 'None'),
        ];
        if (form.get('error')) {
          redirect(response, appLocation({ auth_error: 'apple_cancelled' }), clearCookies);
          return;
        }

        const state = cookieValue(request, 'eat_it_apple_state');
        const nonce = cookieValue(request, 'eat_it_apple_nonce');
        const code = form.get('code');
        if (!state || state !== form.get('state') || !nonce || !code) {
          redirect(response, appLocation({ auth_error: 'apple_failed' }), clearCookies);
          return;
        }
        try {
          const profile = await exchangeAppleCode(code, nonce);
          const user = await findOrCreateOAuthUser(prisma, 'apple', profile);
          const session = await createSession(prisma, user.id);
          redirect(response, appLocation(), [
            sessionCookie(session.token, session.expiresAt, true),
            ...clearCookies,
          ]);
        } catch (error) {
          logger.error(`${method} ${url.pathname}`, error);
          redirect(response, appLocation({ auth_error: 'apple_failed' }), clearCookies);
        }
        return;
      }

      const auth = await authenticate(prisma, request);
      if (!auth) {
        json(response, 401, { error: 'Требуется авторизация' });
        return;
      }
      const { user } = auth;

      if (method === 'GET' && url.pathname === '/api/auth/me') {
        json(response, 200, { user: { ...serializeUser(user), isAdmin: isAdmin(user) } });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/recipes/suggestions') {
        const fridgeItems = await prisma.fridgeItem.findMany({
          where: { householdId: user.householdId, category: 'products' },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
          take: 20,
        });
        const ingredients = Array.from(
          new Set(fridgeItems.map((item) => item.name.trim()).filter(Boolean)),
        ).slice(0, 10);
        if (!ingredients.length) {
          const local = await matchedDishSuggestions(prisma, user.householdId, 'catalog', logger);
          delete local.hasLocalCatalog;
          json(response, 200, local);
          return;
        }

        if (spoonacularApiKey()) {
          try {
            await importRecipeSuggestions(prisma, ingredients);
          } catch (error) {
            logger.error(`${method} ${url.pathname}`, error);
          }
        }

        const local = await matchedDishSuggestions(prisma, user.householdId, 'catalog', logger);
        delete local.hasLocalCatalog;
        json(response, 200, local);
        return;
      }

      const recipeShoppingRoute = routeMatch(
        url.pathname,
        /^\/api\/recipes\/(?<id>[^/]+)\/missing-to-shopping$/,
      );
      if (recipeShoppingRoute && method === 'POST') {
        const result = await addMissingDishIngredientsToShopping(
          prisma,
          user,
          recipeShoppingRoute.id,
        );
        for (const item of result.items) {
          await notifyHouseholdShoppingChange(prisma, user, item, 'added', logger);
        }
        json(response, 200, {
          ...result,
          items: result.items.map(serializeShoppingItem),
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/recipes/matches') {
        const [catalog, own] = await Promise.all([
          matchedDishSuggestions(prisma, user.householdId, 'catalog', logger, null, false),
          matchedDishSuggestions(prisma, user.householdId, 'user'),
        ]);
        json(response, 200, { recipes: [...catalog.recipes, ...own.recipes] });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/recipes/catalog') {
        const input = recipeCatalogQuerySchema.parse(Object.fromEntries(url.searchParams));
        const result = await recipeCatalogPage(prisma, user.householdId, input, logger);
        json(response, 200, result);
        return;
      }

      const recipeDetailsRoute = routeMatch(url.pathname, /^\/api\/recipes\/(?<id>[^/]+)$/);
      if (recipeDetailsRoute && method === 'GET') {
        const dish = await prisma.dish.findFirst({
          where: {
            id: recipeDetailsRoute.id,
            OR: [{ householdId: null }, { householdId: user.householdId }],
          },
        });
        if (!dish) {
          const error = new Error('Рецепт не найден');
          error.status = 404;
          throw error;
        }
        if (!dish.instructions && dish.source !== 'user') {
          try {
            await refreshDishDetails(prisma, dish, logger);
          } catch (error) {
            logger.error(`${method} ${url.pathname}`, error);
          }
        }
        const local = await matchedDishSuggestions(
          prisma,
          user.householdId,
          dish.source === 'user' ? 'user' : 'catalog',
          logger,
          [dish.id],
        );
        const recipe = local.recipes.find((item) => item.id === dish.id);
        json(response, 200, { recipe: recipe ?? null });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/recipes') {
        const fridgeItems = await prisma.fridgeItem.findMany({
          where: { householdId: user.householdId, category: 'products' },
          orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
          take: 20,
        });
        const ingredients = Array.from(
          new Set(fridgeItems.map((item) => item.name.trim()).filter(Boolean)),
        ).slice(0, 10);
        let warning = '';

        if (!spoonacularApiKey()) {
          warning = 'Сервис рецептов временно недоступен. Показаны сохраненные рецепты.';
        } else if (ingredients.length > 0) {
          try {
            await importRecipeSuggestions(prisma, ingredients);
          } catch (error) {
            logger.error(`${method} ${url.pathname}`, error);
            warning =
              error?.status === 429
                ? 'Лимит Spoonacular исчерпан. Показаны сохраненные рецепты.'
                : error?.status === 422
                  ? 'Spoonacular не распознал названия продуктов. Показаны сохраненные рецепты.'
                  : 'Spoonacular временно недоступен. Показаны сохраненные рецепты.';
          }
        }

        const local = await matchedDishSuggestions(prisma, user.householdId, 'catalog', logger);
        delete local.hasLocalCatalog;
        json(response, 200, { ...local, ...(warning ? { warning } : {}) });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dishes') {
        const local = await matchedDishSuggestions(prisma, user.householdId, 'user');
        delete local.hasLocalCatalog;
        json(response, 200, local);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/dishes') {
        const input = dishCreateSchema.parse(await readJson(request));
        await saveUserRecipe(prisma, user, input);
        const local = await matchedDishSuggestions(prisma, user.householdId, 'user');
        delete local.hasLocalCatalog;
        json(response, 201, local);
        return;
      }

      const dishRoute = routeMatch(url.pathname, /^\/api\/dishes\/(?<id>[^/]+)$/);
      if (dishRoute && method === 'PATCH') {
        const input = dishCreateSchema.parse(await readJson(request));
        await saveUserRecipe(prisma, user, input, dishRoute.id);
        const local = await matchedDishSuggestions(prisma, user.householdId, 'user');
        delete local.hasLocalCatalog;
        json(response, 200, local);
        return;
      }

      if (dishRoute && method === 'DELETE') {
        const result = await prisma.dish.deleteMany({
          where: {
            id: dishRoute.id,
            householdId: user.householdId,
            source: 'user',
          },
        });
        if (result.count === 0) {
          const error = new Error('Рецепт не найден');
          error.status = 404;
          throw error;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (method === 'GET' && url.pathname === '/api/meal-plan') {
        await requireHouseholdPlus(prisma, user.householdId);
        const from = new Date();
        from.setUTCHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setUTCDate(to.getUTCDate() + 13);
        const entries = await prisma.mealPlanEntry.findMany({
          where: { householdId: user.householdId, date: { gte: from, lte: to } },
          include: { dish: true },
          orderBy: [{ date: 'asc' }, { mealType: 'asc' }],
        });
        json(response, 200, { entries: entries.map(serializeMealPlanEntry) });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/meal-plan') {
        await requireHouseholdPlus(prisma, user.householdId);
        const input = mealPlanCreateSchema.parse(await readJson(request));
        const dish = await prisma.dish.findFirst({
          where: {
            id: input.dishId,
            OR: [{ householdId: null }, { householdId: user.householdId }],
          },
        });
        if (!dish) {
          const error = new Error('Рецепт не найден');
          error.status = 404;
          throw error;
        }
        const plannedDate = toDate(input.date);
        const entry = await prisma.mealPlanEntry.upsert({
          where: {
            householdId_date_mealType: {
              householdId: user.householdId,
              date: plannedDate,
              mealType: input.mealType,
            },
          },
          update: { dishId: dish.id },
          create: {
            householdId: user.householdId,
            dishId: dish.id,
            date: plannedDate,
            mealType: input.mealType,
          },
          include: { dish: true },
        });
        json(response, 201, serializeMealPlanEntry(entry));
        return;
      }

      const mealPlanRoute = routeMatch(url.pathname, /^\/api\/meal-plan\/(?<id>[^/]+)$/);
      if (mealPlanRoute && method === 'DELETE') {
        await requireHouseholdPlus(prisma, user.householdId);
        const deleted = await prisma.mealPlanEntry.deleteMany({
          where: { id: mealPlanRoute.id, householdId: user.householdId },
        });
        if (deleted.count === 0) {
          const error = new Error('Запись плана не найдена');
          error.status = 404;
          throw error;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (method === 'GET' && url.pathname === '/api/support/tickets') {
        const tickets = await prisma.supportTicket.findMany({
          where: { userId: user.id },
          orderBy: [{ updatedAt: 'desc' }],
          include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        json(response, 200, { tickets: tickets.map(serializeSupportTicket) });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/support/tickets') {
        const input = supportTicketCreateSchema.parse(await readJson(request));
        const ticket = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportTicket.create({
            data: { userId: user.id, subject: input.subject },
          });
          await transaction.supportMessage.create({
            data: {
              ticketId: created.id,
              authorId: user.id,
              authorRole: 'user',
              body: input.message,
            },
          });
          return transaction.supportTicket.findUnique({
            where: { id: created.id },
            include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
          });
        });
        json(response, 201, serializeSupportTicket(ticket));
        return;
      }

      const supportMessagesRoute = routeMatch(
        url.pathname,
        /^\/api\/support\/tickets\/(?<id>[^/]+)\/messages$/,
      );
      if (supportMessagesRoute && method === 'GET') {
        const ticket = await prisma.supportTicket.findFirst({
          where: { id: supportMessagesRoute.id, userId: user.id },
          include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: true } } },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        json(response, 200, {
          ticket: serializeSupportTicket(ticket),
          messages: ticket.messages.map(serializeSupportMessage),
        });
        return;
      }

      if (supportMessagesRoute && method === 'POST') {
        const input = supportMessageCreateSchema.parse(await readJson(request));
        const ticket = await prisma.supportTicket.findFirst({
          where: { id: supportMessagesRoute.id, userId: user.id },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        if (ticket.status === 'closed') {
          const error = new Error('Ticket is closed');
          error.status = 409;
          throw error;
        }
        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportMessage.create({
            data: {
              ticketId: ticket.id,
              authorId: user.id,
              authorRole: 'user',
              body: input.message,
            },
            include: { author: true },
          });
          await transaction.supportTicket.update({
            where: { id: ticket.id },
            data: { updatedAt: new Date() },
          });
          return created;
        });
        json(response, 201, serializeSupportMessage(message));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/feedback') {
        const input = feedbackCreateSchema.parse(await readJson(request));
        const item = await prisma.feedbackItem.create({
          data: { userId: user.id, type: input.type, body: input.message },
        });
        json(response, 201, serializeFeedbackItem(item));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/users') {
        requireAdmin(user);
        const users = await prisma.user.findMany({
          orderBy: [{ createdAt: 'desc' }],
          take: 200,
          include: { household: true },
        });
        json(response, 200, { users: users.map(serializeDevUser) });
        return;
      }

      const devUserSubscriptionRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/users\/(?<id>[^/]+)\/subscription$/,
      );
      if (devUserSubscriptionRoute && method === 'PATCH') {
        requireAdmin(user);
        const input = adminSubscriptionSchema.parse(await readJson(request));
        const target = await prisma.user.findUnique({ where: { id: devUserSubscriptionRoute.id } });
        if (!target) {
          const error = new Error('Пользователь не найден');
          error.status = 404;
          throw error;
        }
        const household = await prisma.household.update({
          where: { id: target.householdId },
          data: input.active
            ? {
                plan: 'plus',
                subscriptionStatus: 'active',
                subscriptionProvider: 'admin',
                subscriptionPeriodEnd: input.periodEnd ? toDate(input.periodEnd) : null,
              }
            : {
                plan: 'free',
                subscriptionStatus: 'inactive',
                subscriptionProvider: 'none',
                subscriptionPeriodEnd: null,
              },
          include: { users: true },
        });
        const updated = await prisma.user.findUnique({
          where: { id: target.id },
          include: { household: true },
        });
        json(response, 200, {
          user: serializeDevUser(updated),
          household: serializeHousehold(household),
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/summary') {
        requireAdmin(user);
        const now = new Date();
        const since = new Date(now.getTime() - 5 * 60 * 1000);
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(dayStart);
        sevenDaysAgo.setUTCDate(dayStart.getUTCDate() - 6);
        const [
          userCount,
          onlineUsers,
          activeSessions,
          householdCount,
          fridgeItems,
          fridgeProducts,
          fridgeHousehold,
          shoppingItems,
          shoppingProducts,
          shoppingHousehold,
          checkedShoppingItems,
          openTickets,
          closedTickets,
          feedbackCount,
          closedFeedback,
          unreadNotifications,
          pendingInvitations,
          newUsersToday,
          newTicketsToday,
          newFeedbackToday,
          recentUsers,
          recentUserActivity,
          recentSessions,
          recentFridgeItems,
          recentShoppingItems,
          recentTickets,
          recentFeedback,
          ticketDaily,
          feedbackDaily,
          unansweredTickets,
          sharedHouseholds,
        ] = await Promise.all([
          prisma.user.count(),
          prisma.session
            .findMany({
              where: { expiresAt: { gt: new Date() }, lastSeenAt: { gte: since } },
              distinct: ['userId'],
            })
            .then((sessions) => sessions.length),
          prisma.session.count({ where: { expiresAt: { gt: now } } }),
          prisma.household.count({ where: { users: { some: {} } } }),
          prisma.fridgeItem.count(),
          prisma.fridgeItem.count({ where: { category: 'products' } }),
          prisma.fridgeItem.count({ where: { category: 'household' } }),
          prisma.shoppingItem.count(),
          prisma.shoppingItem.count({ where: { category: 'products' } }),
          prisma.shoppingItem.count({ where: { category: 'household' } }),
          prisma.shoppingItem.count({ where: { checked: true } }),
          prisma.supportTicket.count({ where: { status: 'open' } }),
          prisma.supportTicket.count({ where: { status: 'closed' } }),
          prisma.feedbackItem.count({ where: { status: 'open' } }),
          prisma.feedbackItem.count({ where: { status: 'closed' } }),
          prisma.notification.count({ where: { readAt: null } }),
          prisma.householdInvitation.count({ where: { status: 'pending' } }),
          prisma.user.count({ where: { createdAt: { gte: dayStart } } }),
          prisma.supportTicket.count({ where: { createdAt: { gte: dayStart } } }),
          prisma.feedbackItem.count({ where: { createdAt: { gte: dayStart } } }),
          prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
          dailyCounts(prisma, 'User', sevenDaysAgo),
          dailyCounts(prisma, 'Session', sevenDaysAgo),
          dailyCounts(prisma, 'FridgeItem', sevenDaysAgo),
          dailyCounts(prisma, 'ShoppingItem', sevenDaysAgo),
          prisma.supportTicket.findMany({
            where: { createdAt: { gte: sevenDaysAgo } },
            orderBy: { createdAt: 'desc' },
            include: { user: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
            take: 20,
          }),
          prisma.feedbackItem.findMany({
            where: { createdAt: { gte: sevenDaysAgo } },
            orderBy: { createdAt: 'desc' },
            include: { user: true },
            take: 20,
          }),
          dailyCounts(prisma, 'SupportTicket', sevenDaysAgo),
          dailyCounts(prisma, 'FeedbackItem', sevenDaysAgo),
          unansweredTicketCount(prisma),
          prisma.$queryRawUnsafe('SELECT COUNT(*) AS total FROM (SELECT "householdId" FROM "User" GROUP BY "householdId" HAVING COUNT(*) > 1)'),
        ]);

        const daily = emptyDailyBuckets(7);
        for (const [field, rows] of Object.entries({
          users: recentUserActivity, sessions: recentSessions,
          fridgeItems: recentFridgeItems, shoppingItems: recentShoppingItems,
          supportTickets: ticketDaily, feedback: feedbackDaily,
        })) {
          for (const row of rows) {
            const day = daily.find((bucket) => bucket.date === row.date);
            if (day) day[field] = row.total;
          }
        }

        const events = [
          ...recentUsers.filter((item) => item.createdAt >= sevenDaysAgo).map((item) => ({
            id: `user-${item.id}`,
            type: 'user',
            title: 'Новый пользователь',
            body: `${item.displayName} · ${item.email}`,
            createdAt: item.createdAt.toISOString(),
          })),
          ...recentTickets.map((item) => ({
            id: `ticket-${item.id}`,
            type: 'support',
            title: 'Обращение в поддержку',
            body: `${item.subject} · ${item.user?.email ?? 'пользователь'}`,
            createdAt: item.createdAt.toISOString(),
          })),
          ...recentFeedback.map((item) => ({
            id: `feedback-${item.id}`,
            type: 'feedback',
            title: item.type === 'bug' ? 'Сообщение о баге' : 'Новый фидбек',
            body: `${item.body} · ${item.user?.email ?? 'пользователь'}`,
            createdAt: item.createdAt.toISOString(),
          })),
        ]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 12);

        json(response, 200, {
          generatedAt: now.toISOString(),
          timezone: 'UTC',
          users: { total: userCount, online: onlineUsers, recent: recentUsers.map(serializeUser) },
          usage: {
            fridgeItems,
            shoppingItems,
            fridgeProducts,
            fridgeHousehold,
            shoppingProducts,
            shoppingHousehold,
            checkedShoppingItems,
          },
          support: {
            openTickets,
            unansweredTickets,
            closedTickets,
            openFeedback: feedbackCount,
            closedFeedback,
            newTicketsToday,
            newFeedbackToday,
          },
          households: { total: householdCount, shared: Number(sharedHouseholds[0].total), pendingInvitations },
          notifications: { unread: unreadNotifications },
          sessions: { active: activeSessions, onlineWindowMinutes: 5 },
          today: {
            newUsers: newUsersToday,
            newTickets: newTicketsToday,
            newFeedback: newFeedbackToday,
          },
          activity: { days: daily },
          events,
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/support/tickets') {
        requireAdmin(user);
        const { filter, offset } = adminSupportQuerySchema.parse(Object.fromEntries(url.searchParams));
        const unansweredPage = filter === 'unanswered'
          ? await prisma.$queryRawUnsafe(
              `SELECT t.id FROM "SupportTicket" t WHERE ${unansweredTicketCondition}
               ORDER BY t."updatedAt" DESC, t.id DESC LIMIT 101 OFFSET ?`, offset,
            )
          : null;
        const where = unansweredPage
          ? { id: { in: unansweredPage.map((ticket) => ticket.id) } }
          : filter === 'all' ? {} : { status: filter };
        const tickets = await prisma.supportTicket.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          include: {
            user: true,
            messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
          },
          skip: unansweredPage ? 0 : offset,
          take: 101,
        });
        json(response, 200, {
          tickets: tickets.slice(0, 100).map(serializeSupportTicket),
          nextOffset: tickets.length > 100 ? offset + 100 : null,
        });
        return;
      }

      const devSupportMessagesRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/support\/tickets\/(?<id>[^/]+)\/messages$/,
      );
      if (devSupportMessagesRoute && method === 'GET') {
        requireAdmin(user);
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: devSupportMessagesRoute.id },
          include: {
            user: true,
            messages: { orderBy: { createdAt: 'asc' }, include: { author: true } },
          },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        json(response, 200, {
          ticket: serializeSupportTicket(ticket),
          messages: ticket.messages.map(serializeSupportMessage),
        });
        return;
      }

      if (devSupportMessagesRoute && method === 'POST') {
        requireAdmin(user);
        const input = supportMessageCreateSchema.parse(await readJson(request));
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: devSupportMessagesRoute.id },
        });
        if (!ticket) {
          const error = new Error('Ticket not found');
          error.status = 404;
          throw error;
        }
        if (ticket.status === 'closed') {
          const error = new Error('Ticket is closed');
          error.status = 409;
          throw error;
        }
        const message = await prisma.$transaction(async (transaction) => {
          const created = await transaction.supportMessage.create({
            data: {
              ticketId: ticket.id,
              authorId: user.id,
              authorRole: 'support',
              body: input.message,
            },
            include: { author: true },
          });
          await transaction.supportTicket.update({
            where: { id: ticket.id },
            data: { updatedAt: new Date() },
          });
          return created;
        });
        json(response, 201, serializeSupportMessage(message));
        return;
      }

      const devSupportCloseRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/support\/tickets\/(?<id>[^/]+)\/close$/,
      );
      if (devSupportCloseRoute && method === 'POST') {
        requireAdmin(user);
        const ticket = await prisma.supportTicket.update({
          where: { id: devSupportCloseRoute.id },
          data: { status: 'closed', closedAt: new Date() },
          include: { user: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        json(response, 200, serializeSupportTicket(ticket));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/dev/feedback') {
        requireAdmin(user);
        const items = await prisma.feedbackItem.findMany({
          orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
          include: { user: true },
          take: 100,
        });
        json(response, 200, { feedback: items.map(serializeFeedbackItem) });
        return;
      }

      if (method === 'GET' && ['/api/dev/recipes', '/api/dev/products'].includes(url.pathname)) {
        requireAdmin(user);
        const { query, offset } = adminCatalogQuerySchema.parse(
          Object.fromEntries(url.searchParams),
        );
        const normalize = (text) => (text ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е');
        const search = normalize(query);
        const isRecipes = url.pathname.endsWith('/recipes');
        const entries = isRecipes
          ? await prisma.dish.findMany({
              where: { householdId: null, source: { not: 'user' } },
              select: { id: true, title: true, originalTitle: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            })
          : await prisma.product.findMany({
              select: { id: true, name: true, originalName: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            });
        const matches = entries.filter(
          (item) =>
            !search ||
            normalize(
              [item.title ?? item.name, item.originalTitle ?? item.originalName].join(' '),
            ).includes(search),
        );
        const ids = matches.slice(offset, offset + 50).map((item) => item.id);
        if (isRecipes) await ensureCatalogLocalized(prisma, ids, logger);
        const records = isRecipes
          ? await prisma.dish.findMany({
              where: { id: { in: ids } },
              include: { ingredients: { include: { product: true } } },
            })
          : await prisma.product.findMany({ where: { id: { in: ids } } });
        const byId = new Map(records.map((record) => [record.id, record]));
        const serialized = ids.map((id) =>
          isRecipes ? serializeDevRecipe(byId.get(id)) : serializeDevProduct(byId.get(id)),
        );
        json(response, 200, {
          [isRecipes ? 'recipes' : 'products']: serialized,
          nextOffset: offset + 50 < matches.length ? offset + 50 : null,
          total: matches.length,
        });
        return;
      }

      const recipeTranslationRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/recipes\/(?<id>[^/]+)\/translation$/,
      );
      if (recipeTranslationRoute && method === 'PATCH') {
        requireAdmin(user);
        const input = adminRecipeTranslationSchema.parse(await readJson(request));
        const recipe = await prisma.$transaction(async (transaction) => {
          const dish = await transaction.dish.findFirst({
            where: { id: recipeTranslationRoute.id, householdId: null, source: { not: 'user' } },
          });
          if (!dish) throw Object.assign(new Error('Рецепт не найден'), { status: 404 });
          return transaction.dish.update({
            where: { id: dish.id },
            data: {
              title: input.title,
              description: input.description,
              instructions: JSON.stringify(input.instructions),
              ...(input.mealTypes === undefined
                ? {}
                : { mealTypes: JSON.stringify(input.mealTypes) }),
              originalTitle: dish.originalTitle ?? dish.title,
              originalDescription: dish.originalDescription ?? dish.description,
              originalInstructions: dish.originalInstructions ?? dish.instructions,
              translationStatus: 'manual',
              detailsFetched: true,
            },
            include: { ingredients: { include: { product: true } } },
          });
        });
        json(response, 200, { recipe: serializeDevRecipe(recipe) });
        return;
      }

      const productTranslationRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/products\/(?<id>[^/]+)\/translation$/,
      );
      if (productTranslationRoute && method === 'PATCH') {
        requireAdmin(user);
        const input = adminProductTranslationSchema.parse(await readJson(request));
        const product = await prisma.$transaction(async (transaction) => {
          const existing = await transaction.product.findUnique({
            where: { id: productTranslationRoute.id },
          });
          if (!existing) throw Object.assign(new Error('Продукт не найден'), { status: 404 });
          return transaction.product.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              originalName: existing.originalName ?? existing.name,
              translationStatus: 'manual',
              aliases: JSON.stringify([
                ...new Set([
                  ...parseJsonArray(existing.aliases),
                  normalizeProductName(existing.name),
                  normalizeProductName(input.name),
                ]),
              ]),
            },
          });
        });
        json(response, 200, { product: serializeDevProduct(product) });
        return;
      }

      const devFeedbackCloseRoute = routeMatch(
        url.pathname,
        /^\/api\/dev\/feedback\/(?<id>[^/]+)\/close$/,
      );
      if (devFeedbackCloseRoute && method === 'POST') {
        requireAdmin(user);
        const item = await prisma.feedbackItem.update({
          where: { id: devFeedbackCloseRoute.id },
          data: { status: 'closed' },
          include: { user: true },
        });
        json(response, 200, serializeFeedbackItem(item));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/household') {
        const household = await getHousehold(prisma, user.householdId);
        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'PATCH' && url.pathname === '/api/household') {
        const input = householdUpdateSchema.parse(await readJson(request));
        const household = await prisma.household.update({
          where: { id: user.householdId },
          data: { name: input.name },
          include: { users: { orderBy: [{ displayName: 'asc' }, { email: 'asc' }] } },
        });
        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/household/leave') {
        const household = await prisma.$transaction(async (transaction) => {
          const member = await transaction.user.findUniqueOrThrow({ where: { id: user.id } });
          const members = await transaction.user.count({ where: { householdId: member.householdId } });
          if (member.householdId !== user.householdId || members < 2) {
            const error = new Error('Вы уже находитесь в личном доме. Обновите страницу.');
            error.status = 409;
            throw error;
          }
          const personal = await transaction.household.create({
            data: { name: `${member.displayName}: дом` },
          });
          await transaction.user.update({
            where: { id: member.id },
            data: { householdId: personal.id },
          });
          await transaction.householdInvitation.deleteMany({
            where: { householdId: member.householdId, inviterId: member.id, status: 'pending' },
          });
          return getHousehold(transaction, personal.id);
        });
        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/household/members') {
        const input = householdMemberSchema.parse(await readJson(request));
        const invitation = await prisma.$transaction(async (transaction) => {
          const member = await transaction.user.findUnique({
            where: { email: input.email },
          });
          if (!member) {
            const error = new Error('User not found');
            error.status = 404;
            throw error;
          }

          if (member.id === user.id || member.householdId === user.householdId) {
            const error = new Error('User is already in this group');
            error.status = 409;
            throw error;
          }

          const household = await transaction.household.findUnique({
            where: { id: user.householdId },
          });
          const created = await transaction.householdInvitation.create({
            data: {
              householdId: user.householdId,
              inviterId: user.id,
              inviteeId: member.id,
            },
          });
          await createNotification(transaction, {
            userId: member.id,
            type: 'group_invite',
            title: 'Приглашение в группу',
            body: `${user.displayName} приглашает вас в группу «${household.name}».`,
            data: { invitationId: created.id, householdId: user.householdId },
            dedupeKey: `group-invite:${created.id}`,
          });
          return created;
        });

        json(response, 201, { invitationId: invitation.id, status: invitation.status });
        return;
      }

      const invitationRoute = routeMatch(
        url.pathname,
        /^\/api\/household\/invitations\/(?<id>[^/]+)\/(?<action>accept|decline)$/,
      );
      if (invitationRoute && method === 'POST') {
        const household = await prisma.$transaction(async (transaction) => {
          const invitation = await transaction.householdInvitation.findFirst({
            where: { id: invitationRoute.id, inviteeId: user.id, status: 'pending' },
            include: { household: true },
          });
          if (!invitation) {
            const error = new Error('Invitation not found');
            error.status = 404;
            throw error;
          }

          if (invitationRoute.action === 'decline') {
            await transaction.householdInvitation.update({
              where: { id: invitation.id },
              data: { status: 'declined' },
            });
            return getHousehold(transaction, user.householdId);
          }

          const sourceHouseholdId = user.householdId;
          await mergeHouseholdInto(transaction, sourceHouseholdId, invitation.householdId);
          await transaction.householdInvitation.update({
            where: { id: invitation.id },
            data: { status: 'accepted' },
          });
          await transaction.householdInvitation.updateMany({
            where: { inviteeId: user.id, status: 'pending', id: { not: invitation.id } },
            data: { status: 'declined' },
          });
          return getHousehold(transaction, invitation.householdId);
        });

        json(response, 200, serializeHousehold(household));
        return;
      }

      if (method === 'GET' && url.pathname === '/api/push/config') {
        const configuration = pushConfiguration();
        json(response, 200, {
          configured: configuration.configured,
          publicKey: configuration.configured ? configuration.publicKey : '',
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/push/subscriptions') {
        const input = pushSubscriptionSchema.parse(await readJson(request));
        await prisma.pushSubscription.upsert({
          where: { endpoint: input.endpoint },
          update: {
            userId: user.id,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
          },
          create: {
            userId: user.id,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
          },
        });
        json(response, 201, { subscribed: true });
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/push/subscriptions') {
        const input = pushUnsubscribeSchema.parse(await readJson(request));
        await prisma.pushSubscription.deleteMany({
          where: { endpoint: input.endpoint, userId: user.id },
        });
        json(response, 200, { subscribed: false });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/notifications') {
        await ensureExpiryNotifications(prisma, user, logger);
        const notifications = await prisma.notification.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        json(response, 200, {
          notifications: notifications.map(serializeNotification),
          unreadCount: notifications.filter((notification) => !notification.readAt).length,
        });
        return;
      }

      if (method === 'GET' && url.pathname === '/api/notification-preferences') {
        const plus = householdHasPlus(await getHousehold(prisma, user.householdId));
        json(response, 200, {
          notifyExpiry: user.notifyExpiry,
          notifyShopping: user.notifyShopping,
          quietHoursStart: plus ? user.quietHoursStart : null,
          quietHoursEnd: plus ? user.quietHoursEnd : null,
          timezone: user.timezone,
        });
        return;
      }

      if (method === 'PATCH' && url.pathname === '/api/notification-preferences') {
        const input = notificationPreferencesSchema.parse(await readJson(request));
        const plus = householdHasPlus(await getHousehold(prisma, user.householdId));
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: plus ? input : { ...input, quietHoursStart: null, quietHoursEnd: null },
        });
        json(response, 200, {
          notifyExpiry: updated.notifyExpiry,
          notifyShopping: updated.notifyShopping,
          quietHoursStart: plus ? updated.quietHoursStart : null,
          quietHoursEnd: plus ? updated.quietHoursEnd : null,
          timezone: updated.timezone,
        });
        return;
      }

      const notificationRoute = routeMatch(url.pathname, /^\/api\/notifications\/(?<id>[^/]+)$/);
      if (notificationRoute && method === 'PATCH') {
        const input = notificationUpdateSchema.parse(await readJson(request));
        const current = await prisma.notification.findFirst({
          where: { id: notificationRoute.id, userId: user.id },
        });
        if (!current) {
          const error = new Error('Notification not found');
          error.status = 404;
          throw error;
        }
        const notification = await prisma.notification.update({
          where: { id: notificationRoute.id },
          data: { readAt: input.read ? new Date() : null },
        });
        json(response, 200, serializeNotification(notification));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        await prisma.session.delete({ where: { id: auth.session.id } });
        json(
          response,
          200,
          { success: true },
          { 'Set-Cookie': clearSessionCookie(isSecureRequest(request)) },
        );
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/auth/account') {
        await prisma.$transaction(async (transaction) => {
          const householdUsers = await transaction.user.count({
            where: { householdId: user.householdId },
          });
          await transaction.user.delete({ where: { id: user.id } });
          if (householdUsers === 1) {
            await transaction.household.delete({ where: { id: user.householdId } });
          }
        });
        json(
          response,
          200,
          { success: true },
          { 'Set-Cookie': clearSessionCookie(isSecureRequest(request)) },
        );
        return;
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        const [fridgeItems, shoppingItems] = await Promise.all([
          prisma.fridgeItem.findMany({
            where: { householdId: user.householdId },
            orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
          }),
          prisma.shoppingItem.findMany({
            where: { householdId: user.householdId },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        json(response, 200, {
          fridgeItems: fridgeItems.map(serializeFridgeItem),
          shoppingItems: shoppingItems.map(serializeShoppingItem),
          household: serializeHousehold(await getHousehold(prisma, user.householdId)),
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/api/fridge') {
        const input = fridgeCreateSchema.parse(await readJson(request));
        const item = await prisma.fridgeItem.create({
          data: { ...input, householdId: user.householdId, expiresAt: toDate(input.expiresAt) },
        });
        json(response, 201, serializeFridgeItem(item));
        return;
      }

      const fridgeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)$/);
      if (fridgeRoute && method === 'PATCH') {
        const input = fridgeUpdateSchema.parse(await readJson(request));
        await findFridgeItem(prisma, fridgeRoute.id, user.householdId);
        const item = await prisma.fridgeItem.update({
          where: { id: fridgeRoute.id },
          data: {
            ...input,
            ...(Object.hasOwn(input, 'expiresAt') ? { expiresAt: toDate(input.expiresAt) } : {}),
          },
        });
        json(response, 200, serializeFridgeItem(item));
        return;
      }

      if (fridgeRoute && method === 'DELETE') {
        await findFridgeItem(prisma, fridgeRoute.id, user.householdId);
        await prisma.fridgeItem.delete({ where: { id: fridgeRoute.id } });
        response.writeHead(204);
        response.end();
        return;
      }

      const consumeRoute = routeMatch(url.pathname, /^\/api\/fridge\/(?<id>[^/]+)\/consume$/);
      if (consumeRoute && method === 'POST') {
        const input = consumeSchema.parse(await readJson(request));
        const current = await findFridgeItem(prisma, consumeRoute.id, user.householdId);
        const remaining = current.quantity - input.quantity;

        if (remaining <= 0) {
          await prisma.fridgeItem.delete({ where: { id: current.id } });
          json(response, 200, { removed: true, item: null });
          return;
        }

        const item = await prisma.fridgeItem.update({
          where: { id: current.id },
          data: { quantity: remaining },
        });
        json(response, 200, { removed: false, item: serializeFridgeItem(item) });
        return;
      }

      const fridgeToShoppingRoute = routeMatch(
        url.pathname,
        /^\/api\/fridge\/(?<id>[^/]+)\/move-to-shopping$/,
      );
      if (fridgeToShoppingRoute && method === 'POST') {
        const result = await prisma.$transaction(async (transaction) => {
          const current = await findFridgeItem(
            transaction,
            fridgeToShoppingRoute.id,
            user.householdId,
          );
          const shoppingItem = await transaction.shoppingItem.create({
            data: {
              householdId: user.householdId,
              name: current.name,
              quantity: current.quantity,
              unit: current.unit,
              category: current.category,
            },
          });
          await transaction.fridgeItem.delete({ where: { id: current.id } });
          return shoppingItem;
        });
        await notifyHouseholdShoppingChange(prisma, user, result, 'added', logger);
        json(response, 200, serializeShoppingItem(result));
        return;
      }

      if (method === 'POST' && url.pathname === '/api/shopping') {
        const input = shoppingCreateSchema.parse(await readJson(request));
        const item = await prisma.shoppingItem.create({
          data: {
            ...input,
            householdId: user.householdId,
          },
        });
        await notifyHouseholdShoppingChange(prisma, user, item, 'added', logger);
        json(response, 201, serializeShoppingItem(item));
        return;
      }

      if (method === 'DELETE' && url.pathname === '/api/shopping/completed') {
        const completedItems = await prisma.shoppingItem.findMany({
          where: { householdId: user.householdId, checked: true },
        });
        const result = await prisma.shoppingItem.deleteMany({
          where: { householdId: user.householdId, checked: true },
        });
        for (const item of completedItems) {
          await notifyHouseholdShoppingChange(prisma, user, item, 'removed', logger);
        }
        json(response, 200, { deleted: result.count });
        return;
      }

      const shoppingRoute = routeMatch(url.pathname, /^\/api\/shopping\/(?<id>[^/]+)$/);
      if (shoppingRoute && method === 'PATCH') {
        const input = shoppingUpdateSchema.parse(await readJson(request));
        await findShoppingItem(prisma, shoppingRoute.id, user.householdId);
        const item = await prisma.shoppingItem.update({
          where: { id: shoppingRoute.id },
          data: input,
        });
        json(response, 200, serializeShoppingItem(item));
        return;
      }

      if (shoppingRoute && method === 'DELETE') {
        const current = await findShoppingItem(prisma, shoppingRoute.id, user.householdId);
        await prisma.shoppingItem.delete({ where: { id: shoppingRoute.id } });
        await notifyHouseholdShoppingChange(prisma, user, current, 'removed', logger);
        response.writeHead(204);
        response.end();
        return;
      }

      const shoppingToFridgeRoute = routeMatch(
        url.pathname,
        /^\/api\/shopping\/(?<id>[^/]+)\/move-to-fridge$/,
      );
      if (shoppingToFridgeRoute && method === 'POST') {
        const input = shoppingToFridgeSchema.parse(await readJson(request));
        const result = await prisma.$transaction(async (transaction) => {
          const current = await findShoppingItem(
            transaction,
            shoppingToFridgeRoute.id,
            user.householdId,
          );
          const fridgeItem = await transaction.fridgeItem.create({
            data: {
              householdId: user.householdId,
              name: current.name,
              quantity: input.quantity ?? current.quantity ?? 1,
              unit: input.unit ?? current.unit ?? 'шт.',
              expiresAt: toDate(input.expiresAt),
              reminderDays: input.reminderDays ?? 1,
              category: input.category ?? current.category,
            },
          });
          await transaction.shoppingItem.delete({ where: { id: current.id } });
          return { fridgeItem, shoppingItem: current };
        });
        await notifyHouseholdShoppingChange(prisma, user, result.shoppingItem, 'removed', logger);
        json(response, 200, serializeFridgeItem(result.fridgeItem));
        return;
      }

      json(response, 404, { error: 'Route not found' });
    } catch (error) {
      if (error instanceof ZodError) {
        json(response, 400, { error: 'Validation failed', details: error.issues });
        return;
      }

      if (error?.code === 'P2002') {
        json(response, 409, { error: 'Такая запись уже существует' });
        return;
      }

      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) {
        logger.error(`${method} ${url?.pathname ?? '/'}`, error);
      }
      json(response, status, { error: status >= 500 ? 'Internal server error' : error.message });
    }
  });
}
